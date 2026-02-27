// OpenRouter Provider Adapter
// OpenRouter exposes an OpenAI-compatible /chat/completions endpoint.

import type {
  ProviderAdapter,
  Request,
  Response,
  StreamEvent,
  ContentPart,
  Usage,
  FinishReason,
} from "./client.js";
import { SDKError } from "./client.js";

function parseUsage(raw: Record<string, unknown>): Usage {
  const u = raw as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}

function parseFinishReason(reason: string): FinishReason {
  const map: Record<string, FinishReason["reason"]> = {
    stop: "stop",
    length: "length",
    tool_calls: "tool_calls",
    content_filter: "content_filter",
  };
  return { reason: map[reason] ?? "other", raw: reason };
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly name = "openrouter";
  private readonly baseUrl = "https://openrouter.ai/api/v1";

  constructor(
    private apiKey: string,
    private defaultModel: string = "moonshotai/kimi-k2",
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/mnesler/maxtory",
      "X-Title": "Attractor Pipeline",
    };
  }

  private buildMessages(request: Request): unknown[] {
    return request.messages.map((msg) => {
      if (msg.role === "tool") {
        return {
          role: "tool",
          tool_call_id: msg.toolCallId,
          content: msg.content
            .filter((p) => p.kind === "tool_result")
            .map((p) =>
              typeof p.toolResult?.content === "string"
                ? p.toolResult.content
                : JSON.stringify(p.toolResult?.content),
            )
            .join("\n"),
        };
      }

      const text = msg.content
        .filter((p) => p.kind === "text")
        .map((p) => p.text)
        .join("\n");

      const toolCalls = msg.content
        .filter((p) => p.kind === "tool_call" && p.toolCall)
        .map((p) => ({
          id: p.toolCall!.id,
          type: "function",
          function: {
            name: p.toolCall!.name,
            arguments:
              typeof p.toolCall!.arguments === "string"
                ? p.toolCall!.arguments
                : JSON.stringify(p.toolCall!.arguments),
          },
        }));

      const result: Record<string, unknown> = { role: msg.role, content: text };
      if (toolCalls.length > 0) result.tool_calls = toolCalls;
      return result;
    });
  }

  private buildBody(request: Request, stream = false): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      messages: this.buildMessages(request),
      stream,
    };

    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.temperature != null) body.temperature = request.temperature;
    if (request.topP != null) body.top_p = request.topP;
    if (request.stopSequences) body.stop = request.stopSequences;

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      if (request.toolChoice) {
        body.tool_choice =
          typeof request.toolChoice === "string"
            ? request.toolChoice
            : { type: "function", function: { name: (request.toolChoice as { name: string }).name } };
      }
    }

    return body;
  }

  async complete(request: Request): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(request)),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new SDKError(
        `OpenRouter API error ${res.status}: ${errText}`,
        res.status,
        "openrouter",
        res.status === 429 || res.status >= 500,
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>>;
    const choice = choices[0];
    const message = choice.message as Record<string, unknown>;

    const parts: ContentPart[] = [];
    if (message.content) {
      parts.push({ kind: "text", text: message.content as string });
    }

    const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown>;
        let args: Record<string, unknown>;
        try { args = JSON.parse(fn.arguments as string); } catch { args = { raw: fn.arguments }; }
        parts.push({
          kind: "tool_call",
          toolCall: { id: tc.id as string, name: fn.name as string, arguments: args },
        });
      }
    }

    return {
      id: data.id as string,
      model: data.model as string ?? request.model,
      provider: "openrouter",
      message: { role: "assistant", content: parts },
      finishReason: parseFinishReason(choice.finish_reason as string),
      usage: data.usage ? parseUsage(data.usage as Record<string, unknown>) : {
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
      },
      raw: data,
    };
  }

  async *stream(request: Request): AsyncIterable<StreamEvent> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(request, true)),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text();
      throw new SDKError(`OpenRouter stream error ${res.status}: ${errText}`, res.status, "openrouter");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;
          try {
            const event = JSON.parse(data) as Record<string, unknown>;
            const choices = event.choices as Array<Record<string, unknown>>;
            if (!choices?.length) continue;
            const delta = choices[0].delta as Record<string, unknown>;
            if (delta?.content) yield { type: "TEXT_DELTA", delta: delta.content as string };
            if (choices[0].finish_reason) {
              yield { type: "FINISH", finishReason: parseFinishReason(choices[0].finish_reason as string) };
            }
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
