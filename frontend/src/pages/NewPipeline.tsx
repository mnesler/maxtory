// NewPipeline page — DOT editor + submit

import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { startRun } from "../store/runs.js";

const EXAMPLE_DOT = `digraph example {
  graph [goal="Run a simple hello-world pipeline"]

  start [shape=Mdiamond, label="Start"]
  greet [shape=box, label="Greet", prompt="Say hello world"]
  done  [shape=Msquare, label="Done"]

  start -> greet
  greet -> done
}
`;

export default function NewPipeline() {
  const [dot, setDot] = createSignal(EXAMPLE_DOT);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!dot().trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const run = await startRun(dot());
      navigate(`/runs/${run.id}`);
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  }

  return (
    <>
      <div class="topbar">
        <h2>New Pipeline</h2>
      </div>
      <div class="content">
        <form onSubmit={handleSubmit}>
          <div class="card mb-4">
            <div class="card-header">
              <span class="card-title">DOT Source</span>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                onClick={() => setDot(EXAMPLE_DOT)}
              >
                Load Example
              </button>
            </div>
            <textarea
              rows={20}
              value={dot()}
              onInput={(e) => setDot((e.target as HTMLTextAreaElement).value)}
              placeholder="digraph mypipeline { ... }"
              spellcheck={false}
            />
          </div>

          {error() && (
            <div
              class="card mb-4"
              style="border-color:var(--fail);color:var(--fail);font-size:13px;"
            >
              {error()}
            </div>
          )}

          <div class="flex gap-2">
            <button type="submit" class="btn btn-primary" disabled={submitting()}>
              {submitting() ? (
                <>
                  <span class="spinner" />
                  Starting...
                </>
              ) : (
                "Run Pipeline"
              )}
            </button>
            <a href="/pipelines" class="btn btn-ghost">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </>
  );
}
