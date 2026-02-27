// Attractor Backend Entry Point
import "dotenv/config";

import { Client } from "./llm/client.js";
import { OpenRouterAdapter } from "./llm/openrouter.js";
import { SimulationBackend, LLMBackend, createDefaultRegistry } from "./pipeline/handlers.js";
import { PipelineEngine } from "./pipeline/engine.js";
import { createApp } from "./api/server.js";

const PORT = parseInt(process.env.PORT ?? "3001");

// ── Settings store (mutable at runtime via API) ───────────────────────────────
export const settings = {
  model: process.env.DEFAULT_MODEL ?? "moonshotai/kimi-k2",
  workspaceRoot: process.env.WORKSPACE_ROOT ?? process.cwd(),
};

// ── LLM client ────────────────────────────────────────────────────────────────
const apiKey = process.env.OPEN_ROUTER_KEY ?? process.env.open_router_key ?? process.env.OPENROUTER_API_KEY ?? "";

const llmClient = new Client();

if (apiKey) {
  llmClient.register(new OpenRouterAdapter(apiKey, settings.model), true);
  console.log(`✓ OpenRouter adapter registered (model: ${settings.model})`);
} else {
  console.warn("⚠ No OPEN_ROUTER_KEY found — running in simulation mode");
}

// ── Pipeline backend ──────────────────────────────────────────────────────────
const pipelineBackend = apiKey
  ? new LLMBackend(llmClient, settings.model)
  : new SimulationBackend();

const registry = createDefaultRegistry(pipelineBackend, llmClient, settings.model, settings.workspaceRoot);
const engine = new PipelineEngine(registry);

// Load persisted runs before accepting requests
await engine.init();

// ── HTTP / WebSocket server ───────────────────────────────────────────────────
const { httpServer } = createApp(engine, settings, llmClient);

httpServer.listen(PORT, () => {
  console.log(`Attractor backend running on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws?runId=<id>`);
});
