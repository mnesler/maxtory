// NodeList component — displays the node execution state for a run

import { For } from "solid-js";
import type { PipelineRun } from "../api/client.js";
import { StatusBadge } from "./StatusBadge.js";

function nodeIcon(status: string): string {
  switch (status) {
    case "SUCCESS": return "✓";
    case "PARTIAL_SUCCESS": return "~";
    case "FAIL": return "✗";
    case "RETRY": return "↻";
    case "current": return "►";
    default: return "○";
  }
}

interface Props {
  run: PipelineRun;
}

export function NodeList(props: Props) {
  // Build ordered list: completed nodes + current (if not completed) + pending (graph nodes if available)
  const allNodeIds = () => {
    const ids = new Set<string>();
    for (const id of props.run.completedNodes) ids.add(id);
    if (props.run.currentNode && !ids.has(props.run.currentNode)) {
      ids.add(props.run.currentNode);
    }
    return Array.from(ids);
  };

  return (
    <div class="node-list">
      <For each={allNodeIds()} fallback={<div class="text-muted text-sm">No nodes executed yet.</div>}>
        {(nodeId) => {
          const outcome = props.run.nodeOutcomes[nodeId];
          const isCurrent = props.run.currentNode === nodeId && !outcome;
          const status = outcome?.status ?? (isCurrent ? "current" : "pending");

          return (
            <div class={`node-item${isCurrent ? " current" : ""}${outcome ? " completed" : ""}`}>
              <span class="node-icon">{nodeIcon(status)}</span>
              <span class="node-id">{nodeId}</span>
              <span class="node-status">
                {outcome ? (
                  <StatusBadge status={outcome.status} />
                ) : isCurrent ? (
                  <span class="badge badge-running pulse">RUNNING</span>
                ) : (
                  <span class="badge badge-pending">PENDING</span>
                )}
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}
