// Anthropic Provider Adapter

import type {
  ProviderAdapter,
  Request,
  Response,
  StreamEvent,
  Message,
  ContentPart,
  ToolCall,
  Usage,
  FinishReason,
} from "./client.js";
import { SDKError } from "./client.js";

function toAnthropicMessages(
  messages: Message[],
): Array<{ role: string; content: unknown }> {
  const result: Array<{ role: string; content: unknown }> = [];
  let systemContent = "";

  for (const msg of messages) {
    if (msg.role === "system") {
      systemContent += msg.content
        .filter((p) => p.kind === "text")
        .map((p) => p.text)
        .join("\n");
      continue;
    }

    const content: unknown[] = [];
    for (const part of msg.content) {
      if (part.kind === "text") {
        content.push({ type: "text", text: part.text });
      } else if (part.kind === "tool_call" && part.toolCall) {
        content.push({
          type: "tool_use",
          id: part.toolCall.id,
          name: part.toolCall.name,
          input:
            typeof part.toolCall.arguments === "string"
              ? JSON.parse(part.toolCall.arguments)
              : part.toolCall.arguments,
        });
      } else if (part.kind === "tool_result" && part.toolResult) {
        content.push({
          type: "tool_result",
          tool_use_id: part.toolResult.toolCallId,
          content: [
            {
              type: "text",
              text:
                typeof part.toolResult.content === "string"
                  ? part.toolResult.content
                  : JSON.stringify(part.toolResult.content),
            },
          ],
          is_error: part.toolResult.isError,
        });
      } else if (part.kind === "thinking" && part.thinking) {
        content.push({
          type: "thinking",
          thinking: part.thinking.text,
          signature: part.thinking.signature,
        });
      }
    }

    const role =
      msg.role === "assistant" ? "assistant" : "user";
    result.push({ role, content });
  }

  return result;
}

function parseAnthropicUsage(raw: Record<string, unknown>): Usage {
  const u = raw as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens: u.cache_read_input_tokens,
    cacheWriteTokens: u.cache_creation_input_tokens,
  };
}

function parseFinishReason(stopReason: string): FinishReason {
  const map: Record<string, FinishReason["reason"]> = {
    end_turn: "stop",
    stop_sequence: "stop",
    max_tokens: "length",
    tool_use: "tool_calls",
  };
  return { reason: map[stopReason] ?? "other", raw: stopReason };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic";
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.anthropic.com") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private buildBody(request: Request): Record<string, unknown> {
    const systemParts = request.messages
      .filter((m) => m.role === "system")
      .flatMap((m) => m.content)
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join("\n");

    const messages = toAnthropicMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 8096,
    };

    if (systemParts) {
      body.system = [
        {
          type: "text",
          text: systemParts,
          cache_control: { type: "ephemeral" },
        },
      ];
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    if (request.temperature != null) body.temperature = request.temperature;
    if (request.topP != null) body.top_p = request.topP;
    if (request.stopSequences) body.stop_sequences = request.stopSequences;

    const po = (request.providerOptions as Record<string, unknown>)?.anthropic as Record<string, unknown> | undefined;
    if (po?.thinking) {
      body.thinking = po.thinking;
    }

    return body;
  }

  private getHeaders(request: Request): Record<string, string> {
    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };

    const po = (request.providerOptions as Record<string, unknown>)?.anthropic as Record<string, unknown> | undefined;
    if (po?.beta_headers && Array.isArray(po.beta_headers)) {
      headers["anthropic-beta"] = po.beta_headers.join(",");
    } else {
      headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    }
    return headers;
  }

  async complete(request: Request): Promise<Response> {
    const body = this.buildBody(request);
    const headers = this.getHeaders(request);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new SDKError(
        `Anthropic API error ${res.status}: ${errText}`,
        res.status,
        "anthropic",
        res.status === 429 || res.status >= 500,
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    return this.parseResponse(data, request.model);
  }

  private parseResponse(data: Record<string, unknown>, model: string): Response {
    const content = data.content as Array<Record<string, unknown>>;
    const parts: ContentPart[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of content) {
      if (block.type === "text") {
        parts.push({ kind: "text", text: block.text as string });
      } else if (block.type === "tool_use") {
        const tc: ToolCall = {
          id: block.id as string,
          name: block.name as string,
          arguments: block.input as Record<string, unknown>,
        };
        toolCalls.push(tc);
        parts.push({
          kind: "tool_call",
          toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
        });
      } else if (block.type === "thinking") {
        parts.push({
          kind: "thinking",
          thinking: {
            text: block.thinking as string,
            signature: block.signature as string | undefined,
          },
        });
      }
    }

    return {
      id: data.id as string,
      model: data.model as string,
      provider: "anthropic",
      message: { role: "assistant", content: parts },
      finishReason: parseFinishReason(data.stop_reason as string),
      usage: parseAnthropicUsage(data.usage as Record<string, unknown>),
      raw: data,
    };
  }

  async *stream(request: Request): AsyncIterable<StreamEvent> {
    const body = { ...this.buildBody(request), stream: true };
    const headers = this.getHeaders(request);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text();
      throw new SDKError(`Anthropic stream error ${res.status}: ${errText}`, res.status, "anthropic");
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
          if (data === "[DONE]") break;
          try {
            const event = JSON.parse(data) as Record<string, unknown>;
            yield* this.parseStreamEvent(event);
          } catch {
            // skip malformed events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private *parseStreamEvent(event: Record<string, unknown>): Iterable<StreamEvent> {
    const type = event.type as string;
    if (type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown>;
      if (delta.type === "text_delta") {
        yield { type: "TEXT_DELTA", delta: delta.text as string };
      } else if (delta.type === "thinking_delta") {
        yield { type: "REASONING_DELTA", reasoningDelta: delta.thinking as string };
      }
    } else if (type === "message_delta") {
      const delta = event.delta as Record<string, unknown>;
      if (delta.stop_reason) {
        yield {
          type: "FINISH",
          finishReason: parseFinishReason(delta.stop_reason as string),
          usage: event.usage ? parseAnthropicUsage(event.usage as Record<string, unknown>) : undefined,
        };
      }
    }
  }
}
