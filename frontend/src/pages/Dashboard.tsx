// Dashboard page — overview stats

import { onMount } from "solid-js";
import { loadRuns, runStats, runList } from "../store/runs.js";
import { StatCard } from "../components/StatCard.js";
import { RunRow } from "../components/RunRow.js";

export default function Dashboard() {
  onMount(loadRuns);

  const stats = runStats;
  const recent = () => runList().slice(0, 5);

  return (
    <>
      <div class="topbar">
        <h2>Dashboard</h2>
      </div>
      <div class="content">
        <div class="grid-4 mb-4">
          <StatCard label="Total Runs" value={stats().total} />
          <StatCard
            label="Running"
            value={stats().running}
            color="var(--accent)"
          />
          <StatCard
            label="Completed"
            value={stats().completed}
            color="var(--success)"
          />
          <StatCard
            label="Success Rate"
            value={`${stats().successRate}%`}
            sub={`${stats().failed} failed`}
            color={stats().successRate >= 80 ? "var(--success)" : "var(--warn)"}
          />
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Recent Runs</span>
            <a href="/pipelines" class="btn btn-ghost btn-sm">
              View all
            </a>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Graph</th>
                  <th>Status</th>
                  <th>Current Node</th>
                  <th>Started</th>
                  <th>Elapsed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent().length === 0 ? (
                  <tr>
                    <td colspan={7} class="text-muted" style="text-align:center;padding:24px;">
                      No runs yet. <a href="/new">Start a pipeline</a>
                    </td>
                  </tr>
                ) : (
                  recent().map((run) => <RunRow run={run} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
