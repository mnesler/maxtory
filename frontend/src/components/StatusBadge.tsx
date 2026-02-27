// StatusBadge component

import type { PipelineStatus, StageStatus } from "../api/client.js";

type AnyStatus = PipelineStatus | StageStatus | string;

function classForStatus(status: AnyStatus): string {
  switch (status) {
    case "COMPLETED":
    case "SUCCESS":
      return "badge badge-success";
    case "FAILED":
    case "FAIL":
      return "badge badge-fail";
    case "EXECUTE":
    case "INITIALIZE":
    case "PARSE":
    case "VALIDATE":
    case "FINALIZE":
      return "badge badge-running";
    case "PARTIAL_SUCCESS":
      return "badge badge-partial";
    case "RETRY":
    case "SKIPPED":
      return "badge badge-warn";
    default:
      return "badge badge-pending";
  }
}

function dotForStatus(status: AnyStatus): string {
  const running = ["EXECUTE", "INITIALIZE", "PARSE", "VALIDATE", "FINALIZE"];
  if (running.includes(status as string)) return "pulse";
  return "";
}

interface Props {
  status: AnyStatus;
  pulse?: boolean;
}

export function StatusBadge(props: Props) {
  return (
    <span class={classForStatus(props.status)}>
      {props.pulse !== false && dotForStatus(props.status) && (
        <span class={`spinner`} style="width:8px;height:8px;border-width:1.5px;" />
      )}
      {props.status}
    </span>
  );
}
