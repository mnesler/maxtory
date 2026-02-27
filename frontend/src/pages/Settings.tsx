// Settings page — configure the active OpenRouter model

import { createSignal, createResource, Show, For } from "solid-js";
import { api } from "../api/client.js";

export default function Settings() {
  const [settings, { refetch }] = createResource(() => api.getSettings());
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal("");
  const [customModel, setCustomModel] = createSignal("");

  async function handleSelect(model: string) {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await api.setModel(model);
      setSaved(true);
      refetch();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleCustomSubmit(e: Event) {
    e.preventDefault();
    const m = customModel().trim();
    if (!m) return;
    await handleSelect(m);
    setCustomModel("");
  }

  return (
    <>
      <div class="topbar">
        <h2>Settings</h2>
      </div>
      <div class="content">
        <Show when={settings.loading}>
          <p class="muted">Loading settings…</p>
        </Show>

        <Show when={settings()}>
          {(s) => (
            <div class="settings-panel">
              <div class="card">
                <div class="card-header">
                  <span class="card-title">Active Model</span>
                </div>
                <div style="padding: 16px;">
                  <div class="active-model-badge">{s().model}</div>
                </div>
              </div>

              <div class="card">
                <div class="card-header">
                  <span class="card-title">Select Model</span>
                </div>
                <div style="padding: 16px;">
                  <div class="model-grid">
                    <For each={s().models}>
                      {(m) => (
                        <button
                          class={`model-card${s().model === m.id ? " selected" : ""}`}
                          onClick={() => handleSelect(m.id)}
                          disabled={saving()}
                        >
                          <span class="model-name">{m.name}</span>
                          <span class="model-id">{m.id}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              <div class="card">
                <div class="card-header">
                  <span class="card-title">Custom Model ID</span>
                </div>
                <div style="padding: 16px; display: flex; flex-direction: column; gap: 10px;">
                  <p class="muted">Enter any OpenRouter model identifier (e.g. <code>mistralai/mistral-large</code>).</p>
                  <form class="custom-model-form" onSubmit={handleCustomSubmit}>
                    <input
                      type="text"
                      class="input"
                      placeholder="provider/model-name"
                      value={customModel()}
                      onInput={(e) => setCustomModel(e.currentTarget.value)}
                    />
                    <button type="submit" class="btn btn-primary" disabled={saving() || !customModel().trim()}>
                      {saving() ? "Saving…" : "Apply"}
                    </button>
                  </form>
                </div>
              </div>

              <Show when={saved()}>
                <div class="alert alert-success">Model updated successfully.</div>
              </Show>
              <Show when={error()}>
                <div class="alert alert-error">{error()}</div>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </>
  );
}
