// OpenAI Provider Adapter (Responses API)

import type {
  ProviderAdapter,
  Request,
  Response,
  StreamEvent,
  ContentPart,
  ToolCall,
  Usage,
  FinishReason,
} from "./client.js";
import { SDKError } from "./client.js";

function parseOpenAIUsage(raw: Record<string, unknown>): Usage {
  const u = raw as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens,
    cacheReadTokens: u.prompt_tokens_details?.cached_tokens,
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

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = "openai";
  private apiKey: string;
  private baseUrl: string;
  private orgId?: string;

  constructor(apiKey: string, baseUrl = "https://api.openai.com", orgId?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.orgId = orgId;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (this.orgId) headers["OpenAI-Organization"] = this.orgId;
    return headers;
  }

  private buildMessages(request: Request): unknown[] {
    return request.messages.map((msg) => {
      const textContent = msg.content
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

      if (msg.role === "tool") {
        return {
          role: "tool",
          tool_call_id: msg.toolCallId,
          content: textContent || msg.content
            .filter((p) => p.kind === "tool_result")
            .map((p) =>
              typeof p.toolResult?.content === "string"
                ? p.toolResult.content
                : JSON.stringify(p.toolResult?.content),
            )
            .join("\n"),
        };
      }

      const result: Record<string, unknown> = { role: msg.role, content: textContent };
      if (toolCalls.length > 0) result.tool_calls = toolCalls;
      return result;
    });
  }

  private buildBody(request: Request): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: this.buildMessages(request),
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

    if (request.reasoningEffort) {
      body.reasoning_effort = request.reasoningEffort;
    }

    return body;
  }

  async complete(request: Request): Promise<Response> {
    const body = this.buildBody(request);

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new SDKError(
        `OpenAI API error ${res.status}: ${errText}`,
        res.status,
        "openai",
        res.status === 429 || res.status >= 500,
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    return this.parseResponse(data, request.model);
  }

  private parseResponse(data: Record<string, unknown>, model: string): Response {
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
        try {
          args = JSON.parse(fn.arguments as string);
        } catch {
          args = { raw: fn.arguments };
        }
        parts.push({
          kind: "tool_call",
          toolCall: {
            id: tc.id as string,
            name: fn.name as string,
            arguments: args,
          },
        });
      }
    }

    return {
      id: data.id as string,
      model: data.model as string,
      provider: "openai",
      message: { role: "assistant", content: parts },
      finishReason: parseFinishReason(choice.finish_reason as string),
      usage: data.usage ? parseOpenAIUsage(data.usage as Record<string, unknown>) : {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      raw: data,
    };
  }

  async *stream(request: Request): AsyncIterable<StreamEvent> {
    const body = { ...this.buildBody(request), stream: true };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text();
      throw new SDKError(`OpenAI stream error ${res.status}: ${errText}`, res.status, "openai");
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
            if (!choices || choices.length === 0) continue;

            const delta = choices[0].delta as Record<string, unknown>;
            if (delta.content) {
              yield { type: "TEXT_DELTA", delta: delta.content as string };
            }
            if (choices[0].finish_reason) {
              yield {
                type: "FINISH",
                finishReason: parseFinishReason(choices[0].finish_reason as string),
              };
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
