// Reactive store for pipeline runs + WebSocket state sync

import { createSignal, createEffect, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { api, type PipelineRun, type PipelineEvent } from "../api/client.js";

// ─── Store state ──────────────────────────────────────────────────────────────

interface RunsState {
  runs: Record<string, PipelineRun>;
  events: Record<string, PipelineEvent[]>;
  humanGates: Record<string, PipelineEvent>; // nodeId -> HUMAN_GATE event
  loading: boolean;
  error: string | null;
}

const [state, setState] = createStore<RunsState>({
  runs: {},
  events: {},
  humanGates: {},
  loading: false,
  error: null,
});

export { state as runsState };

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function loadRuns(): Promise<void> {
  setState("loading", true);
  setState("error", null);
  try {
    const runs = await api.listRuns();
    setState(
      produce((s) => {
        for (const run of runs) {
          s.runs[run.id] = run;
        }
      }),
    );
  } catch (err) {
    setState("error", String(err));
  } finally {
    setState("loading", false);
  }
}

export async function loadRun(id: string): Promise<PipelineRun | null> {
  try {
    const run = await api.getRun(id);
    setState(
      produce((s) => {
        s.runs[run.id] = run;
        // Seed events from nodeOutcomes if the run is already finished
        // and we have no live WS events yet (avoids duplicates on live runs)
        if (!s.events[run.id] || s.events[run.id].length === 0) {
          const seeded: PipelineEvent[] = [];
          for (const nodeId of run.completedNodes) {
            const outcome = run.nodeOutcomes[nodeId];
            if (outcome) {
              seeded.push({
                type: outcome.status === "FAIL" ? "NODE_FAIL" : "NODE_COMPLETE",
                runId: run.id,
                timestamp: run.completedAt ?? run.startedAt,
                nodeId,
                outcome,
              });
            }
          }
          s.events[run.id] = seeded;
        }
      }),
    );
    return run;
  } catch {
    return null;
  }
}

export async function startRun(dotSource: string): Promise<PipelineRun> {
  const run = await api.startRun(dotSource);
  setState(
    produce((s) => {
      s.runs[run.id] = run;
      s.events[run.id] = [];
    }),
  );
  return run;
}

export async function submitHumanAnswer(
  runId: string,
  nodeId: string,
  answer: string,
): Promise<void> {
  await api.submitHumanAnswer(runId, nodeId, answer);
  setState(
    produce((s) => {
      delete s.humanGates[nodeId];
    }),
  );
}

// ─── WebSocket subscription ───────────────────────────────────────────────────

const activeWs = new Map<string, WebSocket>();

export function subscribeToRun(runId: string): () => void {
  if (activeWs.has(runId)) return () => unsubscribeFromRun(runId);

  const ws = api.connectWs(runId, (event) => handleEvent(runId, event));
  activeWs.set(runId, ws);

  ws.onclose = () => {
    activeWs.delete(runId);
  };

  return () => unsubscribeFromRun(runId);
}

export function unsubscribeFromRun(runId: string): void {
  const ws = activeWs.get(runId);
  if (ws) {
    ws.close();
    activeWs.delete(runId);
  }
}

function handleEvent(runId: string, event: PipelineEvent): void {
  setState(
    produce((s) => {
      // Append to event list
      if (!s.events[runId]) s.events[runId] = [];
      if (event.type !== "INITIAL_STATE") {
        s.events[runId].push(event);
      }

      // Handle INITIAL_STATE — sync full run
      if (event.type === "INITIAL_STATE" && event.run) {
        s.runs[runId] = event.run;
        return;
      }

      // Update run status
      const run = s.runs[runId];
      if (!run) return;

      if (event.type === "STATUS_CHANGE") {
        // Refresh run from REST after status change
        api.getRun(runId).then((updated) => {
          setState(produce((s2) => { s2.runs[runId] = updated; }));
        });
        return;
      }

      if (event.type === "NODE_START" && event.nodeId) {
        run.currentNode = event.nodeId;
      }

      if (event.type === "NODE_COMPLETE" || event.type === "NODE_FAIL") {
        if (event.nodeId && !run.completedNodes.includes(event.nodeId)) {
          run.completedNodes.push(event.nodeId);
        }
        if (event.nodeId && event.outcome) {
          run.nodeOutcomes[event.nodeId] = event.outcome;
        }
        if (event.type === "NODE_COMPLETE") {
          // Refresh run after completion to get latest status
          api.getRun(runId).then((updated) => {
            setState(produce((s2) => { s2.runs[runId] = updated; }));
          });
        }
      }

      if (event.type === "HUMAN_GATE" && event.nodeId) {
        s.humanGates[event.nodeId] = event;
      }

      if (event.type === "HUMAN_ANSWER" && event.nodeId) {
        delete s.humanGates[event.nodeId];
      }
    }),
  );
}

// ─── Derived helpers ──────────────────────────────────────────────────────────

export function runList(): PipelineRun[] {
  return Object.values(state.runs).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}

export function runById(id: string): PipelineRun | undefined {
  return state.runs[id];
}

export function eventsForRun(id: string): PipelineEvent[] {
  return state.events[id] ?? [];
}

export function humanGatesForRun(runId: string): PipelineEvent[] {
  const run = state.runs[runId];
  if (!run) return [];
  // Return human gates that belong to this run
  return Object.values(state.humanGates).filter((e) => e.runId === runId);
}

export function runStats() {
  const all = Object.values(state.runs);
  const total = all.length;
  const running = all.filter((r) =>
    r.status === "EXECUTE" || r.status === "INITIALIZE",
  ).length;
  const completed = all.filter((r) => r.status === "COMPLETED").length;
  const failed = all.filter((r) => r.status === "FAILED").length;
  const successRate =
    completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : 0;
  return { total, running, completed, failed, successRate };
}
