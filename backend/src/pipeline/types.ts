// Pipeline execution types

export type StageStatus = "SUCCESS" | "PARTIAL_SUCCESS" | "RETRY" | "FAIL" | "SKIPPED";

export interface Outcome {
  status: StageStatus;
  preferredLabel?: string;
  suggestedNextIds?: string[];
  contextUpdates?: Record<string, unknown>;
  notes?: string;
  failureReason?: string;
}

export interface PipelineContext {
  values: Map<string, unknown>;
  logs: string[];

  get(key: string, defaultValue?: unknown): unknown;
  getString(key: string, defaultValue?: string): string;
  set(key: string, value: unknown): void;
  applyUpdates(updates: Record<string, unknown>): void;
  snapshot(): Record<string, unknown>;
  clone(): PipelineContext;
  appendLog(entry: string): void;
}

export interface Checkpoint {
  timestamp: string;
  currentNode: string;
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  contextValues: Record<string, unknown>;
  logs: string[];
}

export type PipelineStatus = "PARSE" | "VALIDATE" | "INITIALIZE" | "EXECUTE" | "FINALIZE" | "COMPLETED" | "FAILED";

export interface PipelineRun {
  id: string;
  dotSource: string;
  graphId: string;
  graphGoal: string;
  status: PipelineStatus;
  currentNode?: string;
  completedNodes: string[];
  nodeOutcomes: Record<string, Outcome>;
  startedAt: string;
  completedAt?: string;
  logsRoot: string;
  checkpoint?: Checkpoint;
  error?: string;
  notes?: string;
}

export interface PipelineEvent {
  type: "STATUS_CHANGE" | "NODE_START" | "NODE_COMPLETE" | "NODE_FAIL" | "EDGE_SELECTED" | "LOG" | "HUMAN_GATE" | "HUMAN_ANSWER";
  runId: string;
  timestamp: string;
  nodeId?: string;
  outcome?: Outcome;
  edgeLabel?: string;
  message?: string;
  humanChoices?: HumanChoice[];
  humanAnswer?: string;
}

export interface HumanChoice {
  key: string;
  label: string;
  toNode: string;
}
