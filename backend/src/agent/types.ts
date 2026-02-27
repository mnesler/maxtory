// Coding Agent Loop — types

import type { Client, Request, Response, Message, ToolCall, ToolResult, StreamEvent, Usage } from "../llm/client.js";

// ─── Turn Types ────────────────────────────────────────────────────────────────

export interface UserTurn {
  role: "user";
  content: string;
  timestamp: string;
}

export interface AssistantTurn {
  role: "assistant";
  content: string;
  toolCalls: ToolCall[];
  reasoning?: string;
  usage?: Usage;
  responseId?: string;
  timestamp: string;
}

export interface ToolResultsTurn {
  role: "tool_results";
  results: ToolResult[];
  timestamp: string;
}

export interface SteeringTurn {
  role: "steering";
  content: string;
  timestamp: string;
}

export type Turn = UserTurn | AssistantTurn | ToolResultsTurn | SteeringTurn;

// ─── Session State ─────────────────────────────────────────────────────────────

export type SessionState = "IDLE" | "PROCESSING" | "AWAITING_INPUT" | "CLOSED";

// ─── Session Config ────────────────────────────────────────────────────────────

export interface SessionConfig {
  maxTurns: number;                          // 0 = unlimited
  maxToolRoundsPerInput: number;             // 0 = unlimited
  defaultCommandTimeoutMs: number;
  maxCommandTimeoutMs: number;
  reasoningEffort?: "low" | "medium" | "high";
  toolOutputLimits: Record<string, number>;
  enableLoopDetection: boolean;
  loopDetectionWindow: number;
  maxSubagentDepth: number;
}

export const DEFAULT_CONFIG: SessionConfig = {
  maxTurns: 0,
  maxToolRoundsPerInput: 0,
  defaultCommandTimeoutMs: 10_000,
  maxCommandTimeoutMs: 600_000,
  enableLoopDetection: true,
  loopDetectionWindow: 10,
  maxSubagentDepth: 1,
  toolOutputLimits: {
    read_file: 50_000,
    shell: 30_000,
    grep: 20_000,
    glob: 20_000,
    edit_file: 10_000,
    write_file: 1_000,
    spawn_agent: 20_000,
  },
};

// ─── Events ────────────────────────────────────────────────────────────────────

export type AgentEventKind =
  | "SESSION_START"
  | "SESSION_END"
  | "USER_INPUT"
  | "ASSISTANT_TEXT_START"
  | "ASSISTANT_TEXT_DELTA"
  | "ASSISTANT_TEXT_END"
  | "TOOL_CALL_START"
  | "TOOL_CALL_OUTPUT_DELTA"
  | "TOOL_CALL_END"
  | "STEERING_INJECTED"
  | "TURN_LIMIT"
  | "LOOP_DETECTION"
  | "WARNING"
  | "ERROR";

export interface AgentEvent {
  kind: AgentEventKind;
  timestamp: string;
  sessionId: string;
  data: Record<string, unknown>;
}

// ─── ExecResult ────────────────────────────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
  size?: number;
}

export interface GrepOptions {
  caseInsensitive?: boolean;
  globFilter?: string;
  maxResults?: number;
}

// ─── Execution Environment ─────────────────────────────────────────────────────

export interface ExecutionEnvironment {
  readFile(path: string, offset?: number, limit?: number): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  listDirectory(path: string, depth?: number): Promise<DirEntry[]>;
  execCommand(command: string, timeoutMs: number, workingDir?: string, envVars?: Record<string, string>): Promise<ExecResult>;
  grep(pattern: string, path: string, options?: GrepOptions): Promise<string>;
  glob(pattern: string, path: string): Promise<string[]>;
  workingDirectory(): string;
  platform(): string;
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
}

// ─── Tool Registry ─────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  executor: (args: Record<string, unknown>, env: ExecutionEnvironment) => Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }
}

// ─── Provider Profile ──────────────────────────────────────────────────────────

export interface ProviderProfile {
  id: string;
  model: string;
  toolRegistry: ToolRegistry;
  buildSystemPrompt(env: ExecutionEnvironment, projectDocs: string): string;
  tools(): ToolDefinition[];
  providerOptions(): Record<string, unknown> | undefined;
  supportsReasoning: boolean;
  supportsStreaming: boolean;
  supportsParallelToolCalls: boolean;
  contextWindowSize: number;
}

// ─── Subagent ──────────────────────────────────────────────────────────────────

export interface SubAgentResult {
  output: string;
  success: boolean;
  turnsUsed: number;
}

export interface SubAgentHandle {
  id: string;
  status: "running" | "completed" | "failed";
  result?: SubAgentResult;
  // resolve/reject for wait()
  _resolve?: (r: SubAgentResult) => void;
  _reject?: (e: Error) => void;
}
