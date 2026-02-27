// EventLog component — renders a list of pipeline events

import { For } from "solid-js";
import type { PipelineEvent } from "../api/client.js";

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventClass(type: PipelineEvent["type"]): string {
  switch (type) {
    case "NODE_START": return "event-item event-node-start";
    case "NODE_COMPLETE": return "event-item event-node-complete";
    case "NODE_FAIL": return "event-item event-node-fail";
    case "EDGE_SELECTED": return "event-item event-edge";
    case "HUMAN_GATE":
    case "HUMAN_ANSWER": return "event-item event-human";
    case "STATUS_CHANGE": return "event-item event-status";
    default: return "event-item";
  }
}

function eventBody(event: PipelineEvent): string {
  switch (event.type) {
    case "NODE_START": return `→ ${event.nodeId}`;
    case "NODE_COMPLETE": return `✓ ${event.nodeId}${event.outcome ? ` [${event.outcome.status}]` : ""}`;
    case "NODE_FAIL": return `✗ ${event.nodeId}${event.outcome?.failureReason ? `: ${event.outcome.failureReason}` : ""}`;
    case "EDGE_SELECTED": return `${event.nodeId} → ${event.edgeLabel}`;
    case "HUMAN_GATE": return `Waiting for human input at ${event.nodeId}`;
    case "HUMAN_ANSWER": return `Human answered at ${event.nodeId}: ${event.humanAnswer ?? ""}`;
    case "STATUS_CHANGE": return event.message ?? "";
    case "LOG": return event.message ?? "";
    default: return event.message ?? JSON.stringify(event);
  }
}

interface Props {
  events: PipelineEvent[];
  maxHeight?: string;
}

export function EventLog(props: Props) {
  return (
    <div
      class="event-log"
      style={props.maxHeight ? `max-height:${props.maxHeight};overflow-y:auto;` : ""}
    >
      <For each={props.events} fallback={<div class="text-muted text-sm">No events yet.</div>}>
        {(event) => (
          <div class={eventClass(event.type)}>
            <span class="event-time">{formatTime(event.timestamp)}</span>
            <span class="event-type">{event.type}</span>
            <span class="event-body">{eventBody(event)}</span>
          </div>
        )}
      </For>
    </div>
  );
}
