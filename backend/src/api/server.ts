// REST + WebSocket API server

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { PipelineEngine } from "../pipeline/engine.js";
import { WaitForHumanHandler } from "../pipeline/handlers.js";
import type { PipelineEvent } from "../pipeline/types.js";
import type { Client } from "../llm/client.js";
import { Message } from "../llm/client.js";

export interface AppSettings {
  model: string;
}

// Popular OpenRouter models for the UI picker
export const OPENROUTER_MODELS = [
  { id: "moonshotai/kimi-k2", name: "Kimi K2 (Moonshot)" },
  { id: "anthropic/claude-opus-4-5", name: "Claude Opus 4.5" },
  { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
  { id: "openai/gpt-4o", name: "GPT-4o" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
  { id: "qwen/qwen3-235b-a22b", name: "Qwen3 235B" },
];

export function createApp(engine: PipelineEngine, settings: AppSettings, llmClient?: Client) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // ── Runs ─────────────────────────────────────────────────────────────────────

  // POST /api/runs/from-prompt — generate DOT from plain-text prompt via LLM, then start run
  const PIPELINE_SYSTEM_PROMPT = `You are a pipeline architect. Convert the user's description into a valid Graphviz DOT pipeline definition.

Rules:
- Use digraph with a descriptive graph ID (no spaces)
- Include: graph [goal="..."] with a concise goal
- Start node: shape=Mdiamond, label="Start"
- End node: shape=Msquare, label="Done"
- Intermediate nodes: shape=box, with a prompt="..." attribute describing what the LLM should do at that stage — be specific and detailed in the prompt
- Connect nodes with edges: start -> node1 -> node2 -> done
- Use 2–5 intermediate nodes appropriate to the task

Output ONLY the DOT source inside a \`\`\`dot code block. No explanation, no other text.`;

  app.post("/api/runs/from-prompt", async (req, res) => {
    if (!llmClient) {
      return res.status(503).json({ error: "LLM client not available — check OPEN_ROUTER_KEY" });
    }
    const { prompt } = req.body as { prompt?: string };
    if (!prompt?.trim()) {
      return res.status(400).json({ error: "prompt is required" });
    }
    try {
      const llmResponse = await llmClient.complete({
        model: settings.model,
        messages: [
          Message.system(PIPELINE_SYSTEM_PROMPT),
          Message.user(prompt.trim()),
        ],
      });
      const rawText = Message.getText(llmResponse.message);
      // Extract DOT source from ```dot ... ``` or ``` ... ``` fences
      const match = rawText.match(/```(?:dot)?\s*(digraph[\s\S]*?)```/);
      if (!match) {
        return res.status(422).json({
          error: "LLM did not return a valid DOT block",
          raw: rawText.slice(0, 500),
        });
      }
      const dotSource = match[1].trim();
      const run = await engine.start(dotSource, settings.model);
      res.status(201).json(run);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/runs — start a new pipeline run
  app.get("/api/runs", (_req, res) => {
    res.json(engine.getAllRuns());
  });

  // GET /api/runs/:id — get a specific run
  app.get("/api/runs/:id", (req, res) => {
    const run = engine.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found" });
    res.json(run);
  });

  // POST /api/runs — start a new pipeline run
  app.post("/api/runs", async (req, res) => {
    const { dotSource } = req.body as { dotSource?: string };
    if (!dotSource) {
      return res.status(400).json({ error: "dotSource is required" });
    }
    try {
      const run = await engine.start(dotSource, settings.model);
      res.status(201).json(run);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/runs/:id/human-answer — submit answer to a human gate
  app.post("/api/runs/:id/human-answer", (req, res) => {
    const { nodeId, answer } = req.body as { nodeId?: string; answer?: string };
    if (!nodeId || !answer) {
      return res.status(400).json({ error: "nodeId and answer are required" });
    }
    const ok = WaitForHumanHandler.submitAnswer(req.params.id, nodeId, answer);
    if (!ok) {
      return res.status(404).json({ error: "No pending human gate for this run/node" });
    }
    res.json({ ok: true });
  });

  // GET /api/runs/:id/logs — get log files for a run
  app.get("/api/runs/:id/logs", async (req, res) => {
    const run = engine.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found" });

    try {
      const { promises: fs } = await import("fs");
      const { join } = await import("path");
      const entries = await fs.readdir(run.logsRoot, { withFileTypes: true });
      const files: Array<{ name: string; isDir: boolean }> = entries.map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
      }));
      res.json({ logsRoot: run.logsRoot, files });
    } catch {
      res.json({ logsRoot: run.logsRoot, files: [] });
    }
  });

  // GET /api/runs/:id/logs/:stage/:file — get a specific log file
  app.get("/api/runs/:id/logs/:stage/:file", async (req, res) => {
    const run = engine.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found" });

    try {
      const { promises: fs } = await import("fs");
      const { join } = await import("path");
      const safePath = join(
        run.logsRoot,
        req.params.stage.replace(/\.\./g, ""),
        req.params.file.replace(/\.\./g, ""),
      );
      const content = await fs.readFile(safePath, "utf-8");
      res.type("text/plain").send(content);
    } catch {
      res.status(404).json({ error: "File not found" });
    }
  });

  // GET /api/health
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // ── Settings ──────────────────────────────────────────────────────────────────

  // GET /api/settings — return current model config + available models
  app.get("/api/settings", (_req, res) => {
    res.json({ model: settings.model, models: OPENROUTER_MODELS });
  });

  // PATCH /api/settings — update model
  app.patch("/api/settings", (req, res) => {
    const { model } = req.body as { model?: string };
    if (!model) return res.status(400).json({ error: "model is required" });
    settings.model = model;
    res.json({ model: settings.model });
  });

  // ── WebSocket ─────────────────────────────────────────────────────────────────
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const runId = url.searchParams.get("runId");

    if (!runId) {
      ws.close(1008, "runId is required");
      return;
    }

    // Send current run state immediately
    const run = engine.getRun(runId);
    if (run) {
      ws.send(JSON.stringify({ type: "INITIAL_STATE", run }));
    }

    // Subscribe to run events
    const unsubscribe = engine.subscribe(runId, (event: PipelineEvent) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
      }
    });

    ws.on("close", () => unsubscribe());
    ws.on("error", () => unsubscribe());
  });

  return { app, httpServer };
}
