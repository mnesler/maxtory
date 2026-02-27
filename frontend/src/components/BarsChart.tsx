// BarsChart — animated bar chart for pipeline node outcome data

import { createMemo, For } from "solid-js";
import type { PipelineRun } from "../api/client.js";

type OutcomeStatus = "SUCCESS" | "FAIL" | "PARTIAL_SUCCESS" | "RETRY" | "SKIPPED";

const STATUS_ORDER: OutcomeStatus[] = [
  "SUCCESS",
  "FAIL",
  "PARTIAL_SUCCESS",
  "RETRY",
  "SKIPPED",
];

const STATUS_COLORS: Record<OutcomeStatus, string> = {
  SUCCESS:         "#11ff73",  // neon green
  FAIL:            "#ff2a6d",  // electric red
  PARTIAL_SUCCESS: "#ff9f1a",  // bright orange
  RETRY:           "#ffee00",  // highlighter yellow
  SKIPPED:         "#a855f7",  // vivid violet
};

const STATUS_LABELS: Record<OutcomeStatus, string> = {
  SUCCESS:         "Success",
  FAIL:            "Fail",
  PARTIAL_SUCCESS: "Partial",
  RETRY:           "Retry",
  SKIPPED:         "Skipped",
};

interface Props {
  run: PipelineRun;
}

export function BarsChart(props: Props) {
  // ── Status summary bars ────────────────────────────────────────────────────
  const statusCounts = createMemo(() => {
    const map: Record<string, number> = {};
    for (const nodeId of props.run.completedNodes) {
      const status = props.run.nodeOutcomes[nodeId]?.status ?? "SKIPPED";
      map[status] = (map[status] ?? 0) + 1;
    }
    return map;
  });

  const statusBars = createMemo(() =>
    STATUS_ORDER.map((s) => ({ status: s, count: statusCounts()[s] ?? 0 }))
      .filter((b) => b.count > 0)
  );

  const maxStatusCount = createMemo(() =>
    Math.max(1, ...statusBars().map((b) => b.count))
  );

  // ── Per-node bars ──────────────────────────────────────────────────────────
  const nodeBars = createMemo(() =>
    props.run.completedNodes.map((nodeId) => ({
      id: nodeId,
      status: (props.run.nodeOutcomes[nodeId]?.status ?? "SKIPPED") as OutcomeStatus,
    }))
  );

  const BAR_MAX_H = 120; // px

  return (
    <div class="bars-tab">
      {/* ── Section 1: status counts ─────────────────────────────────────── */}
      <div class="bars-section">
        <div class="bars-section-title">Status Summary</div>
        <div class="bars-group">
          <For each={statusBars()}>
            {(bar, i) => {
              const h = () => Math.max(4, (bar.count / maxStatusCount()) * BAR_MAX_H);
              return (
                <div
                  class="bar-col"
                  style={{ "--delay": `${i() * 60}ms` } as any}
                >
                  <span class="bar-top-label" style={{ color: STATUS_COLORS[bar.status] }}>
                    {bar.count}
                  </span>
                  <div class="bar-track">
                    <div
                      class="bar-fill bar-animate"
                      style={{
                        height: `${h()}px`,
                        background: STATUS_COLORS[bar.status],
                        "box-shadow": `0 0 10px ${STATUS_COLORS[bar.status]}88`,
                        "animation-delay": `${i() * 60}ms`,
                      }}
                    />
                  </div>
                  <span class="bar-bottom-label">{STATUS_LABELS[bar.status]}</span>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      {/* ── Section 2: per-node ───────────────────────────────────────────── */}
      <div class="bars-section">
        <div class="bars-section-title">Node Outcomes</div>
        <div class="bars-group bars-group-nodes">
          <For each={nodeBars()}>
            {(bar, i) => (
              <div
                class="bar-col bar-col-node"
                style={{ "--delay": `${i() * 50}ms` } as any}
              >
                <span class="bar-top-label" style={{ color: STATUS_COLORS[bar.status] }}>
                  {bar.status.charAt(0)}
                </span>
                <div class="bar-track">
                  <div
                    class="bar-fill bar-animate"
                    style={{
                      height: `${BAR_MAX_H}px`,
                      background: `linear-gradient(to top, ${STATUS_COLORS[bar.status]}, ${STATUS_COLORS[bar.status]}aa)`,
                      "box-shadow": `0 0 12px ${STATUS_COLORS[bar.status]}99`,
                      "animation-delay": `${i() * 50}ms`,
                    }}
                  />
                </div>
                <span class="bar-bottom-label bar-bottom-label-node">{bar.id}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
