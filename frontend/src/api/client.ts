// API client for the Attractor backend

export interface PipelineRun {
  id: string;
  dotSource: string;
  graphId: string;
  graphGoal: string;
  status: "PARSE" | "VALIDATE" | "INITIALIZE" | "EXECUTE" | "FINALIZE" | "COMPLETED" | "FAILED";
  currentNode?: string;
  completedNodes: string[];
  nodeOutcomes: Record<string, Outcome>;
  startedAt: string;
  completedAt?: string;
  logsRoot: string;
  error?: string;
  notes?: string;
}

export interface Outcome {
  status: "SUCCESS" | "PARTIAL_SUCCESS" | "RETRY" | "FAIL" | "SKIPPED";
  preferredLabel?: string;
  suggestedNextIds?: string[];
  contextUpdates?: Record<string, unknown>;
  notes?: string;
  failureReason?: string;
}

export interface HumanChoice {
  key: string;
  label: string;
  toNode: string;
}

export interface PipelineEvent {
  type:
    | "STATUS_CHANGE"
    | "NODE_START"
    | "NODE_COMPLETE"
    | "NODE_FAIL"
    | "EDGE_SELECTED"
    | "LOG"
    | "HUMAN_GATE"
    | "HUMAN_ANSWER"
    | "INITIAL_STATE";
  runId: string;
  timestamp: string;
  nodeId?: string;
  outcome?: Outcome;
  edgeLabel?: string;
  message?: string;
  humanChoices?: HumanChoice[];
  humanAnswer?: string;
  run?: PipelineRun;
}

export interface LogEntry {
  name: string;
  isDir: boolean;
}

const BASE = "/api";

export const api = {
  async listRuns(): Promise<PipelineRun[]> {
    const res = await fetch(`${BASE}/runs`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async getRun(id: string): Promise<PipelineRun> {
    const res = await fetch(`${BASE}/runs/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async startRun(dotSource: string): Promise<PipelineRun> {
    const res = await fetch(`${BASE}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dotSource }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  },

  async submitHumanAnswer(runId: string, nodeId: string, answer: string): Promise<void> {
    const res = await fetch(`${BASE}/runs/${runId}/human-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId, answer }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
  },

  async getLogs(runId: string): Promise<{ logsRoot: string; files: LogEntry[] }> {
    const res = await fetch(`${BASE}/runs/${runId}/logs`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async getLogFile(runId: string, stage: string, file: string): Promise<string> {
    const res = await fetch(`${BASE}/runs/${runId}/logs/${stage}/${file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },

  connectWs(runId: string, onEvent: (event: PipelineEvent) => void): WebSocket {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws?runId=${runId}`);
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as PipelineEvent;
        onEvent(event);
      } catch { /* ignore */ }
    };
    return ws;
  },
};
