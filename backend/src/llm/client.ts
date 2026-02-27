// Unified LLM Client - types matching the Attractor spec

export type Role = "system" | "user" | "assistant" | "tool" | "developer";

export type ContentKind =
  | "text"
  | "image"
  | "audio"
  | "document"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "redacted_thinking";

export interface ImageData {
  url?: string;
  data?: Buffer;
  mediaType?: string;
  detail?: "auto" | "low" | "high";
}

export interface ToolCallData {
  id: string;
  name: string;
  arguments: Record<string, unknown> | string;
  type?: string;
}

export interface ToolResultData {
  toolCallId: string;
  content: string | Record<string, unknown>;
  isError: boolean;
}

export interface ThinkingData {
  text: string;
  signature?: string;
  redacted?: boolean;
}

export interface ContentPart {
  kind: ContentKind | string;
  text?: string;
  image?: ImageData;
  toolCall?: ToolCallData;
  toolResult?: ToolResultData;
  thinking?: ThinkingData;
}

export interface Message {
  role: Role;
  content: ContentPart[];
  name?: string;
  toolCallId?: string;
}

// Convenience constructors
export const Message = {
  system: (text: string): Message => ({
    role: "system",
    content: [{ kind: "text", text }],
  }),
  user: (text: string): Message => ({
    role: "user",
    content: [{ kind: "text", text }],
  }),
  assistant: (text: string): Message => ({
    role: "assistant",
    content: [{ kind: "text", text }],
  }),
  toolResult: (toolCallId: string, content: string, isError = false): Message => ({
    role: "tool",
    toolCallId,
    content: [{ kind: "tool_result", toolResult: { toolCallId, content, isError } }],
  }),
  getText: (msg: Message): string =>
    msg.content
      .filter((p) => p.kind === "text" && p.text)
      .map((p) => p.text!)
      .join(""),
};

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export type ToolChoice = "auto" | "none" | "required" | { name: string };

export interface ResponseFormat {
  type: "text" | "json" | "json_schema";
  jsonSchema?: Record<string, unknown>;
  strict?: boolean;
}

export interface Request {
  model: string;
  messages: Message[];
  provider?: string;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  responseFormat?: ResponseFormat;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stopSequences?: string[];
  reasoningEffort?: "none" | "low" | "medium" | "high";
  metadata?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
}

export interface FinishReason {
  reason: "stop" | "length" | "tool_calls" | "content_filter" | "error" | "other";
  raw?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    reasoningTokens:
      a.reasoningTokens != null || b.reasoningTokens != null
        ? (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0)
        : undefined,
    cacheReadTokens:
      a.cacheReadTokens != null || b.cacheReadTokens != null
        ? (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0)
        : undefined,
    cacheWriteTokens:
      a.cacheWriteTokens != null || b.cacheWriteTokens != null
        ? (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0)
        : undefined,
  };
}

export interface Response {
  id: string;
  model: string;
  provider: string;
  message: Message;
  finishReason: FinishReason;
  usage: Usage;
  raw?: Record<string, unknown>;
  warnings?: string[];
}

export interface StreamEvent {
  type: string;
  delta?: string;
  textId?: string;
  reasoningDelta?: string;
  toolCall?: Partial<ToolCall>;
  finishReason?: FinishReason;
  usage?: Usage;
  response?: Response;
  error?: Error;
  raw?: Record<string, unknown>;
}

// Provider Adapter Interface
export interface ProviderAdapter {
  readonly name: string;
  complete(request: Request): Promise<Response>;
  stream(request: Request): AsyncIterable<StreamEvent>;
}

// Model info catalog
export interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  contextWindow: number;
  maxOutput?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  aliases?: string[];
}

export const MODEL_CATALOG: ModelInfo[] = [
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    displayName: "Claude Opus 4.6",
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.5",
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    id: "gpt-5.2",
    provider: "openai",
    displayName: "GPT-5.2",
    contextWindow: 1047576,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    id: "gpt-5.2-codex",
    provider: "openai",
    displayName: "GPT-5.2 Codex",
    contextWindow: 1047576,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    id: "gemini-3-flash-preview",
    provider: "gemini",
    displayName: "Gemini 3 Flash (Preview)",
    contextWindow: 1048576,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
];

// HTTP error types
export class SDKError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly provider?: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "SDKError";
  }
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof SDKError) return err.retryable;
  return false;
}

function detectProvider(model: string): string {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  if (model.startsWith("gemini")) return "gemini";
  return "openai";
}

// Main Client
export class Client {
  private adapters = new Map<string, ProviderAdapter>();
  private defaultProvider?: string;
  private middleware: Array<
    (req: Request, next: (r: Request) => Promise<Response>) => Promise<Response>
  > = [];

  register(adapter: ProviderAdapter, isDefault = false): void {
    this.adapters.set(adapter.name, adapter);
    if (isDefault || !this.defaultProvider) {
      this.defaultProvider = adapter.name;
    }
  }

  use(
    mw: (req: Request, next: (r: Request) => Promise<Response>) => Promise<Response>,
  ): void {
    this.middleware.push(mw);
  }

  private resolveProvider(req: Request): ProviderAdapter {
    const providerName = req.provider ?? this.defaultProvider ?? detectProvider(req.model);
    const adapter = this.adapters.get(providerName);
    if (!adapter) {
      throw new SDKError(`No adapter registered for provider: ${providerName}`);
    }
    return adapter;
  }

  async complete(request: Request): Promise<Response> {
    type Handler = (req: Request) => Promise<Response>;
    const execute: Handler = async (req: Request): Promise<Response> => {
      return this.resolveProvider(req).complete(req);
    };

    // Apply middleware chain (right to left)
    const chain = this.middleware.reduceRight<Handler>(
      (next, mw) => (req: Request) => mw(req, next),
      execute,
    );
    return chain(request);
  }

  async *stream(request: Request): AsyncIterable<StreamEvent> {
    yield* this.resolveProvider(request).stream(request);
  }

  static async fromEnv(): Promise<Client> {
    const client = new Client();

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const { AnthropicAdapter } = await import("./anthropic.js");
        client.register(new AnthropicAdapter(process.env.ANTHROPIC_API_KEY), true);
      } catch { /* anthropic sdk not installed */ }
    }

    if (process.env.OPENAI_API_KEY) {
      try {
        const { OpenAIAdapter } = await import("./openai.js");
        client.register(new OpenAIAdapter(process.env.OPENAI_API_KEY), !process.env.ANTHROPIC_API_KEY);
      } catch { /* openai sdk not installed */ }
    }

    return client;
  }
}
