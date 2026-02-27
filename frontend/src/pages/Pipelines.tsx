// Pipelines page — full list of all runs

import { onMount } from "solid-js";
import { A } from "@solidjs/router";
import { loadRuns, runList } from "../store/runs.js";
import { RunRow } from "../components/RunRow.js";

export default function Pipelines() {
  onMount(loadRuns);

  const runs = runList;

  return (
    <>
      <div class="topbar">
        <h2>Pipelines</h2>
        <A href="/new" class="btn btn-primary btn-sm">
          + Agent
        </A>
      </div>
      <div class="content">
        <div class="card">
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
                {runs().length === 0 ? (
                  <tr>
                    <td colspan={7} class="text-muted" style="text-align:center;padding:24px;">
                      No runs yet. <A href="/new">Start a pipeline</A>
                    </td>
                  </tr>
                ) : (
                  runs().map((run) => <RunRow run={run} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
