// Logs page — browse log files for a run

import { createSignal, onMount, For, Show } from "solid-js";
import { useParams, A } from "@solidjs/router";
import { api, type LogEntry } from "../api/client.js";

export default function Logs() {
  const params = useParams<{ id: string }>();
  const [entries, setEntries] = createSignal<LogEntry[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<{ stage: string; file: string } | null>(null);
  const [fileContent, setFileContent] = createSignal<string | null>(null);
  const [fileLoading, setFileLoading] = createSignal(false);

  onMount(async () => {
    try {
      const data = await api.getLogs(params.id);
      setEntries(data.files);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  });

  async function openFile(stage: string, file: string) {
    setSelected({ stage, file });
    setFileLoading(true);
    setFileContent(null);
    try {
      const content = await api.getLogFile(params.id, stage, file);
      setFileContent(content);
    } catch (err) {
      setFileContent(`Error: ${err}`);
    } finally {
      setFileLoading(false);
    }
  }

  return (
    <>
      <div class="topbar">
        <div class="flex items-center gap-3">
          <A href={`/runs/${params.id}`} class="btn btn-ghost btn-sm">
            ← Back
          </A>
          <h2>
            Logs — <span class="font-mono" style="font-size:13px;">{params.id.slice(0, 8)}</span>
          </h2>
        </div>
      </div>
      <div class="content">
        <Show when={error()}>
          <div class="card mb-4" style="color:var(--fail)">{error()}</div>
        </Show>

        <div class="grid-2">
          {/* File tree */}
          <div class="card">
            <div class="card-header">
              <span class="card-title">Files</span>
            </div>
            <Show when={loading()}>
              <div class="text-muted text-sm">Loading...</div>
            </Show>
            <Show when={!loading() && entries().length === 0}>
              <div class="text-muted text-sm">No log files found.</div>
            </Show>
            <div class="flex-col gap-2">
              <For each={entries()}>
                {(entry) => {
                  const parts = entry.name.split("/");
                  const stage = parts[0];
                  const file = parts.slice(1).join("/");
                  return (
                    <button
                      class={`choice-btn${selected()?.stage === stage && selected()?.file === file ? " active" : ""}`}
                      onClick={() => openFile(stage, file)}
                      style={
                        selected()?.stage === stage && selected()?.file === file
                          ? "border-color:var(--accent)"
                          : ""
                      }
                    >
                      <span class="font-mono text-sm">{entry.name}</span>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          {/* File content */}
          <div class="card">
            <div class="card-header">
              <span class="card-title">
                {selected() ? `${selected()!.stage}/${selected()!.file}` : "Select a file"}
              </span>
            </div>
            <Show when={fileLoading()}>
              <div class="text-muted text-sm">Loading...</div>
            </Show>
            <Show when={!fileLoading() && fileContent() !== null}>
              <pre class="code-block" style="max-height:500px;overflow-y:auto;">
                {fileContent()}
              </pre>
            </Show>
            <Show when={!selected() && !fileLoading()}>
              <div class="text-muted text-sm">Select a file to view its contents.</div>
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}
