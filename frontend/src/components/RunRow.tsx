// RunRow — a table row for a single pipeline run

import { A } from "@solidjs/router";
import type { PipelineRun } from "../api/client.js";
import { StatusBadge } from "./StatusBadge.js";

function elapsed(run: PipelineRun): string {
  const start = new Date(run.startedAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  run: PipelineRun;
}

export function RunRow(props: Props) {
  return (
    <tr>
      <td>
        <A href={`/runs/${props.run.id}`} class="font-mono" style="font-size:12px;">
          {props.run.id.slice(0, 8)}
        </A>
      </td>
      <td class="truncate" style="max-width:200px;" title={props.run.graphId}>
        {props.run.graphId || <span class="text-muted">—</span>}
      </td>
      <td>
        <StatusBadge status={props.run.status} />
      </td>
      <td class="text-muted">{props.run.currentNode ?? "—"}</td>
      <td class="text-muted">{formatDate(props.run.startedAt)}</td>
      <td class="text-muted">{elapsed(props.run)}</td>
      <td>
        <A href={`/runs/${props.run.id}`} class="btn btn-ghost btn-sm">
          View
        </A>
      </td>
    </tr>
  );
}
