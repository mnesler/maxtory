// REST + WebSocket API server

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { PipelineEngine } from "../pipeline/engine.js";
import { WaitForHumanHandler } from "../pipeline/handlers.js";
import type { PipelineEvent } from "../pipeline/types.js";

export function createApp(engine: PipelineEngine) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // ── Runs ─────────────────────────────────────────────────────────────────────

  // GET /api/runs — list all runs
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
      const run = await engine.start(dotSource);
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
