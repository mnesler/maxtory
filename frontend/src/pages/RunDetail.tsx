// RunDetail page — single run view with nodes, events, human gate

import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { useParams, A } from "@solidjs/router";
import {
  loadRun,
  subscribeToRun,
  runById,
  eventsForRun,
  humanGatesForRun,
} from "../store/runs.js";
import { api } from "../api/client.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { NodeList } from "../components/NodeList.js";
import { EventLog } from "../components/EventLog.js";
import { HumanGateModal } from "../components/HumanGateModal.js";
import { BarsChart } from "../components/BarsChart.js";

type Tab = "nodes" | "bars" | "logs" | "events" | "dot" | "context";

interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

interface StageLog {
  response?: string;
  toolCalls?: ToolCallRecord[];
}

export default function RunDetail() {
  const params = useParams<{ id: string }>();
  const [tab, setTab] = createSignal<Tab>("nodes");
  const [dismissedGates, setDismissedGates] = createSignal<Set<string>>(new Set());
  const [nodeLogs, setNodeLogs] = createSignal<Record<string, StageLog>>({});
  const [expandedToolCalls, setExpandedToolCalls] = createSignal<Set<string>>(new Set());

  onMount(async () => {
    await loadRun(params.id);
    const unsub = subscribeToRun(params.id);
    onCleanup(unsub);
    // Load response.md for each completed node
    loadNodeLogs(params.id);
  });

  async function loadNodeLogs(runId: string) {
    try {
      const { files } = await api.getLogs(runId);
      const dirs = files.filter((f) => f.isDir).map((f) => f.name);
      const entries: Record<string, StageLog> = {};
      await Promise.all(
        dirs.map(async (stage) => {
          const stageLog: StageLog = {};
          await Promise.all([
            api.getLogFile(runId, stage, "response.md")
              .then((c) => { stageLog.response = c; })
              .catch(() => {}),
            api.getLogFile(runId, stage, "tool_calls.jsonl")
              .then((raw) => {
                stageLog.toolCalls = raw
                  .trim()
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => {
                    try { return JSON.parse(line) as ToolCallRecord; }
                    catch { return null; }
                  })
                  .filter((r): r is ToolCallRecord => r !== null);
              })
              .catch(() => {}),
          ]);
          if (stageLog.response || stageLog.toolCalls) {
            entries[stage] = stageLog;
          }
        })
      );
      setNodeLogs(entries);
    } catch { /* ignore */ }
  }

  function toggleToolCall(key: string) {
    setExpandedToolCalls((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const run = () => runById(params.id);
  const events = () => eventsForRun(params.id);
  const gates = () =>
    humanGatesForRun(params.id).filter(
      (g) => !dismissedGates().has(g.nodeId!),
    );

  function dismissGate(nodeId: string) {
    setDismissedGates((prev) => new Set([...prev, nodeId]));
  }

  function progressPct(): number {
    const r = run();
    if (!r) return 0;
    if (r.status === "COMPLETED") return 100;
    // Heuristic: completed / (completed + 2 pending)
    const c = r.completedNodes.length;
    return Math.min(90, (c / (c + 2)) * 100);
  }

  return (
    <>
      {/* Human gate modals */}
      <For each={gates()}>
        {(gate) => (
          <HumanGateModal
            gate={gate}
            onClose={() => dismissGate(gate.nodeId!)}
          />
        )}
      </For>

      <div class="topbar">
        <div class="flex items-center gap-3">
          <A href="/pipelines" class="btn btn-ghost btn-sm">
            ← Back
          </A>
          <h2 class="font-mono" style="font-size:14px;">
            Run {params.id.slice(0, 8)}
          </h2>
          <Show when={run()}>
            {(r) => <StatusBadge status={r().status} />}
          </Show>
        </div>
        <Show when={run()?.status === "EXECUTE"}>
          <span class="text-muted text-sm">
            Current: <strong>{run()?.currentNode}</strong>
          </span>
        </Show>
      </div>

      <Show when={run()} fallback={<div class="content text-muted">Loading...</div>}>
        {(r) => (
          <div class="content">
            {/* Progress bar */}
            <div class="progress-bar mb-4">
              <div class="progress-fill" style={`width:${progressPct()}%`} />
            </div>

            {/* Meta */}
            <div class="card mb-4">
              <div class="card-header">
                <span class="card-title">Info</span>
              </div>
              <table>
                <tbody>
                  <tr>
                    <td class="text-muted">Graph ID</td>
                    <td class="font-mono">{r().graphId || "—"}</td>
                  </tr>
                  <tr>
                    <td class="text-muted">Goal</td>
                    <td>{r().graphGoal || "—"}</td>
                  </tr>
                  <tr>
                    <td class="text-muted">Model</td>
                    <td class="font-mono">{r().model || "—"}</td>
                  </tr>
                  <tr>
                    <td class="text-muted">Started</td>
                    <td class="text-muted">{new Date(r().startedAt).toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td class="text-muted">Completed</td>
                    <td class="text-muted">
                      {r().completedAt ? new Date(r().completedAt!).toLocaleString() : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td class="text-muted">Nodes Done</td>
                    <td>{r().completedNodes.length}</td>
                  </tr>
                  {r().error && (
                    <tr>
                      <td class="text-muted" style="color:var(--fail)">Error</td>
                      <td style="color:var(--fail)">{r().error}</td>
                    </tr>
                  )}
                  {r().notes && (
                    <tr>
                      <td class="text-muted">Notes</td>
                      <td>{r().notes}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Tabs */}
            <div class="card">
              <div class="tabs">
                {(["nodes", "bars", "logs", "events", "dot"] as Tab[]).map((t) => (
                  <div
                    class={`tab${tab() === t ? " active" : ""}`}
                    onClick={() => setTab(t)}
                  >
                    {t === "nodes" && "Nodes"}
                    {t === "bars" && "Bars"}
                    {t === "logs" && `Logs (${Object.keys(nodeLogs()).length})`}
                    {t === "events" && `Events (${events().length})`}
                    {t === "dot" && "DOT Source"}
                  </div>
                ))}
              </div>

              <Show when={tab() === "nodes"}>
                <NodeList run={r()} />
              </Show>

              <Show when={tab() === "bars"}>
                <BarsChart run={r()} />
              </Show>

              <Show when={tab() === "logs"}>
                <div class="node-logs">
                  <For each={Object.entries(nodeLogs())} fallback={<p class="text-muted" style="padding:12px">No logs available.</p>}>
                    {([stage, stageLog]) => (
                      <div class="node-log-entry">
                        <div class="node-log-label">{stage}</div>
                        <Show when={stageLog.toolCalls && stageLog.toolCalls.length > 0}>
                          <div class="tool-calls-section">
                            <div class="tool-calls-header">
                              Tool Calls ({stageLog.toolCalls!.length})
                            </div>
                            <For each={stageLog.toolCalls!}>
                              {(tc, i) => {
                                const key = `${stage}-${i()}`;
                                return (
                                  <div class="tool-call-item">
                                    <div
                                      class="tool-call-summary"
                                      onClick={() => toggleToolCall(key)}
                                      style="cursor:pointer;display:flex;gap:8px;align-items:center;padding:6px 8px;background:var(--surface-alt,#1e1e2e);border-radius:4px;margin-bottom:4px"
                                    >
                                      <span style="color:var(--accent,#89b4fa);font-family:monospace">{tc.tool}</span>
                                      <span class="text-muted" style="font-size:11px">
                                        {expandedToolCalls().has(key) ? "▲ collapse" : "▼ expand"}
                                      </span>
                                    </div>
                                    <Show when={expandedToolCalls().has(key)}>
                                      <div style="padding:0 8px 8px">
                                        <div class="text-muted" style="font-size:11px;margin-bottom:4px">Args</div>
                                        <pre class="code-block" style="max-height:200px;overflow:auto;margin-bottom:8px">{JSON.stringify(tc.args, null, 2)}</pre>
                                        <div class="text-muted" style="font-size:11px;margin-bottom:4px">Result</div>
                                        <pre class="code-block" style="max-height:200px;overflow:auto">{tc.result}</pre>
                                      </div>
                                    </Show>
                                  </div>
                                );
                              }}
                            </For>
                          </div>
                        </Show>
                        <Show when={stageLog.response}>
                          <pre class="code-block" style="max-height:400px;overflow:auto">{stageLog.response}</pre>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={tab() === "events"}>
                <EventLog events={events()} maxHeight="500px" />
              </Show>

              <Show when={tab() === "dot"}>
                <pre class="code-block">{r().dotSource}</pre>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </>
  );
}
