// Coding Agent Loop — Session

import { v4 as uuid } from "uuid";
import type { Client, Message, ToolCall, ToolResult, Response as LLMResponse } from "../llm/client.js";
import { Message as MessageUtil } from "../llm/client.js";
import type {
  Turn,
  UserTurn,
  AssistantTurn,
  ToolResultsTurn,
  SteeringTurn,
  SessionConfig,
  SessionState,
  AgentEvent,
  AgentEventKind,
  ProviderProfile,
  ExecutionEnvironment,
  SubAgentHandle,
  SubAgentResult,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { truncateOutput, truncateLines } from "./tools.js";
import { discoverProjectDocs } from "./docs.js";

const DEFAULT_CHAR_LIMITS: Record<string, number> = {
  read_file: 50_000,
  shell: 30_000,
  grep: 20_000,
  glob: 20_000,
  edit_file: 10_000,
  write_file: 1_000,
  spawn_agent: 20_000,
  apply_patch: 10_000,
};

const DEFAULT_TRUNCATION_MODES: Record<string, "head_tail" | "tail"> = {
  read_file: "head_tail",
  shell: "head_tail",
  grep: "tail",
  glob: "tail",
  edit_file: "tail",
  apply_patch: "tail",
  write_file: "tail",
  spawn_agent: "head_tail",
};

const DEFAULT_LINE_LIMITS: Record<string, number | undefined> = {
  shell: 256,
  grep: 200,
  glob: 500,
  read_file: undefined,
  edit_file: undefined,
};

// ─── Tool call signature for loop detection ────────────────────────────────────

function toolCallSignature(tc: ToolCall): string {
  return `${tc.name}:${JSON.stringify(tc.arguments)}`;
}

// ─── Convert history turns to LLM messages ─────────────────────────────────────

function historyToMessages(history: Turn[]): Message[] {
  const messages: Message[] = [];

  for (const turn of history) {
    if (turn.role === "user") {
      messages.push(MessageUtil.user(turn.content));
    } else if (turn.role === "assistant") {
      const parts: Message["content"] = [];
      if (turn.content) {
        parts.push({ kind: "text", text: turn.content });
      }
      for (const tc of turn.toolCalls) {
        parts.push({ kind: "tool_call", toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments } });
      }
      messages.push({ role: "assistant", content: parts });
    } else if (turn.role === "tool_results") {
      for (const r of turn.results) {
        messages.push(MessageUtil.toolResult(r.toolCallId, r.content, r.isError));
      }
    } else if (turn.role === "steering") {
      messages.push(MessageUtil.user(turn.content));
    }
  }

  return messages;
}

// ─── Session ───────────────────────────────────────────────────────────────────

export class Session {
  readonly id: string;
  private history: Turn[] = [];
  state: SessionState = "IDLE";
  private steeringQueue: string[] = [];
  private followupQueue: string[] = [];
  private subagents = new Map<string, SubAgentHandle>();
  private eventListeners: Array<(event: AgentEvent) => void> = [];
  private abortController = new AbortController();
  private config: SessionConfig;
  private subagentDepth: number;

  constructor(
    public readonly profile: ProviderProfile,
    public readonly env: ExecutionEnvironment,
    public readonly llmClient: Client,
    config?: Partial<SessionConfig>,
    subagentDepth = 0,
  ) {
    this.id = uuid();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.subagentDepth = subagentDepth;
    this.emit("SESSION_START", {});
  }

  // ─── Event system ────────────────────────────────────────────────────────────

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private emit(kind: AgentEventKind, data: Record<string, unknown>): void {
    const event: AgentEvent = {
      kind,
      timestamp: new Date().toISOString(),
      sessionId: this.id,
      data,
    };
    for (const listener of this.eventListeners) {
      try { listener(event); } catch {}
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  steer(message: string): void {
    this.steeringQueue.push(message);
  }

  followUp(message: string): void {
    this.followupQueue.push(message);
  }

  abort(): void {
    this.abortController.abort();
  }

  close(): void {
    this.abortController.abort();
    this.state = "CLOSED";
    this.emit("SESSION_END", { state: this.state });
  }

  getHistory(): Turn[] {
    return [...this.history];
  }

  // ─── Main entry point ─────────────────────────────────────────────────────────

  async submit(userInput: string): Promise<void> {
    if (this.state === "CLOSED") throw new Error("Session is closed");
    this.state = "PROCESSING";

    this.history.push({ role: "user", content: userInput, timestamp: new Date().toISOString() });
    this.emit("USER_INPUT", { content: userInput });

    try {
      await this.runLoop();
    } finally {
      if ((this.state as SessionState) !== "CLOSED") {
        this.state = "IDLE";
      }
    }
  }

  // ─── Core loop ────────────────────────────────────────────────────────────────

  private async runLoop(): Promise<void> {
    this.drainSteering();

    let roundCount = 0;

    while (true) {
      // Check abort
      if (this.abortController.signal.aborted) break;

      // Check limits
      if (this.config.maxToolRoundsPerInput > 0 && roundCount >= this.config.maxToolRoundsPerInput) {
        this.emit("TURN_LIMIT", { round: roundCount });
        break;
      }
      const totalTurns = this.history.filter((t) => t.role === "user" || t.role === "assistant").length;
      if (this.config.maxTurns > 0 && totalTurns >= this.config.maxTurns) {
        this.emit("TURN_LIMIT", { totalTurns });
        break;
      }

      // Build and send LLM request
      const projectDocs = await discoverProjectDocs(this.env.workingDirectory(), this.profile.id);
      const systemPrompt = this.profile.buildSystemPrompt(this.env, projectDocs);
      const messages = historyToMessages(this.history);

      const request = {
        model: this.profile.model,
        messages: [MessageUtil.system(systemPrompt), ...messages],
        tools: this.profile.tools().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters as Record<string, unknown>,
        })),
        toolChoice: "auto" as const,
        reasoningEffort: this.config.reasoningEffort,
        provider: this.profile.id,
      };

      let response: LLMResponse;
      try {
        this.emit("ASSISTANT_TEXT_START", {});
        response = await this.llmClient.complete(request);
      } catch (err) {
        this.emit("ERROR", { message: String(err) });
        this.state = "CLOSED";
        break;
      }

      // Extract text and tool calls from the response message
      const responseText = MessageUtil.getText(response.message);
      const responseToolCalls = response.message.content
        .filter((p) => p.kind === "tool_call" && p.toolCall)
        .map((p) => p.toolCall!);
      const responseReasoning = response.message.content
        .filter((p) => p.kind === "thinking" && p.thinking)
        .map((p) => p.thinking!.text)
        .join("");

      // Record assistant turn
      const assistantTurn: AssistantTurn = {
        role: "assistant",
        content: responseText,
        toolCalls: responseToolCalls as ToolCall[],
        reasoning: responseReasoning || undefined,
        usage: response.usage,
        responseId: response.id,
        timestamp: new Date().toISOString(),
      };
      this.history.push(assistantTurn);
      this.emit("ASSISTANT_TEXT_END", {
        text: responseText,
        reasoning: responseReasoning,
        usage: response.usage,
      });

      // Context window warning
      this.checkContextUsage();

      // Natural completion — no tool calls
      if (responseToolCalls.length === 0) break;

      // Execute tool calls
      roundCount++;
      const results = await this.executeToolCalls(responseToolCalls as ToolCall[]);
      const toolResultsTurn: ToolResultsTurn = {
        role: "tool_results",
        results,
        timestamp: new Date().toISOString(),
      };
      this.history.push(toolResultsTurn);

      // Drain steering injected during tool execution
      this.drainSteering();

      // Loop detection
      if (this.config.enableLoopDetection) {
        if (this.detectLoop()) {
          const warning = `Loop detected: the last ${this.config.loopDetectionWindow} tool calls follow a repeating pattern. Try a different approach.`;
          this.history.push({ role: "steering", content: warning, timestamp: new Date().toISOString() });
          this.emit("LOOP_DETECTION", { message: warning });
        }
      }
    }

    // Process follow-up queue
    if (this.followupQueue.length > 0) {
      const next = this.followupQueue.shift()!;
      await this.submit(next);
    }

    if (this.state !== "CLOSED") {
      this.emit("SESSION_END", { state: "IDLE" });
    }
  }

  // ─── Tool execution ───────────────────────────────────────────────────────────

  private async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    if (this.profile.supportsParallelToolCalls && toolCalls.length > 1) {
      return Promise.all(toolCalls.map((tc) => this.executeSingleTool(tc)));
    }
    const results: ToolResult[] = [];
    for (const tc of toolCalls) {
      results.push(await this.executeSingleTool(tc));
    }
    return results;
  }

  private async executeSingleTool(toolCall: ToolCall): Promise<ToolResult> {
    this.emit("TOOL_CALL_START", { toolName: toolCall.name, callId: toolCall.id });

    // Subagent tools
    if (toolCall.name === "spawn_agent") return this.handleSpawnAgent(toolCall);
    if (toolCall.name === "wait") return this.handleWaitAgent(toolCall);
    if (toolCall.name === "close_agent") return this.handleCloseAgent(toolCall);

    const registered = this.profile.toolRegistry.get(toolCall.name);
    if (!registered) {
      const error = `Unknown tool: ${toolCall.name}`;
      this.emit("TOOL_CALL_END", { callId: toolCall.id, error });
      return { toolCallId: toolCall.id, content: error, isError: true };
    }

    try {
      const args = typeof toolCall.arguments === "string"
        ? JSON.parse(toolCall.arguments)
        : toolCall.arguments ?? {};

      const rawOutput = await registered.executor(args as Record<string, unknown>, this.env);

      // Truncate for LLM
      const maxChars = this.config.toolOutputLimits[toolCall.name] ?? DEFAULT_CHAR_LIMITS[toolCall.name] ?? 30_000;
      const mode = DEFAULT_TRUNCATION_MODES[toolCall.name] ?? "tail";
      let truncated = truncateOutput(rawOutput, maxChars, mode);
      const maxLines = DEFAULT_LINE_LIMITS[toolCall.name];
      if (maxLines) truncated = truncateLines(truncated, maxLines);

      // Emit full output to event stream
      this.emit("TOOL_CALL_END", { callId: toolCall.id, output: rawOutput });

      return { toolCallId: toolCall.id, content: truncated, isError: false };
    } catch (err) {
      const error = `Tool error (${toolCall.name}): ${err}`;
      this.emit("TOOL_CALL_END", { callId: toolCall.id, error });
      return { toolCallId: toolCall.id, content: error, isError: true };
    }
  }

  // ─── Subagent handling ────────────────────────────────────────────────────────

  private async handleSpawnAgent(toolCall: ToolCall): Promise<ToolResult> {
    if (this.subagentDepth >= this.config.maxSubagentDepth) {
      return {
        toolCallId: toolCall.id,
        content: `Cannot spawn subagent: max depth (${this.config.maxSubagentDepth}) reached`,
        isError: true,
      };
    }

    const args = typeof toolCall.arguments === "string"
      ? JSON.parse(toolCall.arguments)
      : toolCall.arguments ?? {};

    const task = args.task as string;
    const agentId = uuid();

    // Create a child session
    const child = new Session(
      this.profile,
      this.env,
      this.llmClient,
      { ...this.config, maxTurns: (args.max_turns as number | undefined) ?? 0 },
      this.subagentDepth + 1,
    );

    const handle: SubAgentHandle = { id: agentId, status: "running" };
    this.subagents.set(agentId, handle);

    // Run async
    child.submit(task).then(() => {
      const result: SubAgentResult = {
        output: child.getHistory()
          .filter((t) => t.role === "assistant")
          .map((t) => (t as AssistantTurn).content)
          .join("\n"),
        success: true,
        turnsUsed: child.getHistory().length,
      };
      handle.status = "completed";
      handle.result = result;
      handle._resolve?.(result);
    }).catch((err) => {
      handle.status = "failed";
      handle._reject?.(err);
    });

    return { toolCallId: toolCall.id, content: `Spawned subagent ${agentId}`, isError: false };
  }

  private async handleWaitAgent(toolCall: ToolCall): Promise<ToolResult> {
    const args = typeof toolCall.arguments === "string"
      ? JSON.parse(toolCall.arguments)
      : toolCall.arguments ?? {};
    const agentId = args.agent_id as string;
    const handle = this.subagents.get(agentId);

    if (!handle) {
      return { toolCallId: toolCall.id, content: `Unknown agent: ${agentId}`, isError: true };
    }

    if (handle.status === "completed" && handle.result) {
      return { toolCallId: toolCall.id, content: handle.result.output, isError: false };
    }

    if (handle.status === "failed") {
      return { toolCallId: toolCall.id, content: `Agent ${agentId} failed`, isError: true };
    }

    // Wait for completion
    const result = await new Promise<SubAgentResult>((resolve, reject) => {
      handle._resolve = resolve;
      handle._reject = reject;
    });
    return {
      toolCallId: toolCall.id,
      content: truncateOutput(result.output, 20_000, "head_tail"),
      isError: false,
    };
  }

  private handleCloseAgent(toolCall: ToolCall): ToolResult {
    const args = typeof toolCall.arguments === "string"
      ? JSON.parse(toolCall.arguments)
      : toolCall.arguments ?? {};
    const agentId = args.agent_id as string;
    this.subagents.delete(agentId);
    return { toolCallId: toolCall.id, content: `Agent ${agentId} closed`, isError: false };
  }

  // ─── Steering ─────────────────────────────────────────────────────────────────

  private drainSteering(): void {
    while (this.steeringQueue.length > 0) {
      const msg = this.steeringQueue.shift()!;
      const turn: SteeringTurn = { role: "steering", content: msg, timestamp: new Date().toISOString() };
      this.history.push(turn);
      this.emit("STEERING_INJECTED", { content: msg });
    }
  }

  // ─── Loop detection ───────────────────────────────────────────────────────────

  private detectLoop(): boolean {
    const window = this.config.loopDetectionWindow;
    const allToolCalls: ToolCall[] = [];

    for (const turn of this.history) {
      if (turn.role === "assistant") {
        for (const tc of (turn as AssistantTurn).toolCalls) {
          allToolCalls.push(tc);
        }
      }
    }

    if (allToolCalls.length < window) return false;
    const recent = allToolCalls.slice(-window).map(toolCallSignature);

    for (const patternLen of [1, 2, 3]) {
      if (window % patternLen !== 0) continue;
      const pattern = recent.slice(0, patternLen);
      let allMatch = true;
      for (let i = patternLen; i < window; i += patternLen) {
        for (let j = 0; j < patternLen; j++) {
          if (recent[i + j] !== pattern[j]) {
            allMatch = false;
            break;
          }
        }
        if (!allMatch) break;
      }
      if (allMatch) return true;
    }
    return false;
  }

  // ─── Context window check ─────────────────────────────────────────────────────

  private checkContextUsage(): void {
    const totalChars = this.history.reduce((sum, turn) => {
      if (turn.role === "user") return sum + turn.content.length;
      if (turn.role === "assistant") return sum + (turn as AssistantTurn).content.length;
      return sum;
    }, 0);
    const approxTokens = totalChars / 4;
    const threshold = this.profile.contextWindowSize * 0.8;
    if (approxTokens > threshold) {
      const pct = Math.round((approxTokens / this.profile.contextWindowSize) * 100);
      this.emit("WARNING", { message: `Context usage at ~${pct}% of context window` });
    }
  }
}
