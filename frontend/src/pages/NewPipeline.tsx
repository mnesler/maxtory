// NewPipeline page — plain-text prompt → LLM generates DOT → run starts

import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { api } from "../api/client.js";

export default function NewPipeline() {
  const [prompt, setPrompt] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!prompt().trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const run = await api.startRunFromPrompt(prompt().trim());
      navigate(`/runs/${run.id}`);
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  }

  return (
    <>
      <div class="topbar">
        <h2>Agent</h2>
      </div>
      <div class="content">
        <form onSubmit={handleSubmit}>
          <div class="card mb-4">
            <textarea
              style="min-height:120px"
              value={prompt()}
              onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
              placeholder="Describe what you want the pipeline to do…"
              spellcheck={false}
              disabled={submitting()}
            />
          </div>

          {error() && (
            <div class="alert alert-error mb-4">{error()}</div>
          )}

          <div class="flex gap-2">
            <button
              type="submit"
              class="btn btn-primary"
              disabled={submitting() || !prompt().trim()}
            >
              {submitting() ? (
                <>
                  <span class="spinner" />
                  Generating pipeline from prompt…
                </>
              ) : (
                "Start Pipeline"
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
