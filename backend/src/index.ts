// Attractor Backend Entry Point

import { Client } from "./llm/client.js";
import { AnthropicAdapter } from "./llm/anthropic.js";
import { OpenAIAdapter } from "./llm/openai.js";
import { SimulationBackend } from "./pipeline/handlers.js";
import { createDefaultRegistry } from "./pipeline/handlers.js";
import { PipelineEngine } from "./pipeline/engine.js";
import { createApp } from "./api/server.js";

const PORT = parseInt(process.env.PORT ?? "3001");

// Set up LLM client
const llmClient = new Client();

if (process.env.ANTHROPIC_API_KEY) {
  llmClient.register(new AnthropicAdapter(process.env.ANTHROPIC_API_KEY));
  console.log("✓ Anthropic adapter registered");
}
if (process.env.OPENAI_API_KEY) {
  llmClient.register(new OpenAIAdapter(process.env.OPENAI_API_KEY));
  console.log("✓ OpenAI adapter registered");
}

// Use simulation backend if no LLM keys provided
const backend = new SimulationBackend();

const registry = createDefaultRegistry(backend);
const engine = new PipelineEngine(registry);

// Load persisted runs before accepting requests
await engine.init();

const { httpServer } = createApp(engine);

httpServer.listen(PORT, () => {
  console.log(`Attractor backend running on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws?runId=<id>`);
});
