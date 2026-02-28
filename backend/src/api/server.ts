// REST + WebSocket API server

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { PipelineEngine } from "../pipeline/engine.js";
import { WaitForHumanHandler } from "../pipeline/handlers.js";
import type { PipelineEvent } from "../pipeline/types.js";
import type { Client } from "../llm/client.js";
import { Message } from "../llm/client.js";
import passport from "../auth/strategies.js";
import { signAccessToken, signRefreshToken, verifyToken } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";
import type { User } from "../auth/db.js";

export interface AppSettings {
  model: string;
  workspaceRoot: string;
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
  app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(passport.initialize());

  // ── Authentication ───────────────────────────────────────────────────────────

  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

  // GitHub OAuth
  app.get("/auth/github", passport.authenticate("github", { session: false, scope: ["user:email"] }));

  app.get(
    "/auth/github/callback",
    passport.authenticate("github", { session: false, failureRedirect: `${FRONTEND_URL}?error=github_auth_failed` }),
    (req, res) => {
      const user = req.user as User;
      const accessToken = signAccessToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      });
      const refreshToken = signRefreshToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      });

      res.cookie("refresh_token", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.redirect(`${FRONTEND_URL}/auth?token=${accessToken}`);
    }
  );

  // Get current user
  app.get("/auth/me", requireAuth, (req, res) => {
    res.json(req.authUser);
  });

  // Refresh access token using refresh token
  app.post("/auth/refresh", (req, res) => {
    try {
      const refreshToken = req.cookies.refresh_token || req.body.refreshToken;
      if (!refreshToken) {
        return res.status(401).json({ error: "No refresh token provided" });
      }

      const payload = verifyToken(refreshToken);
      if (payload.type !== "refresh") {
        return res.status(401).json({ error: "Invalid token type" });
      }

      const newAccessToken = signAccessToken({
        userId: payload.userId,
        email: payload.email,
        name: payload.name,
        avatar: payload.avatar,
      });

      res.json({ accessToken: newAccessToken });
    } catch {
      res.status(401).json({ error: "Invalid or expired refresh token" });
    }
  });

  // Logout (clear cookies)
  app.post("/auth/logout", (_req, res) => {
    res.clearCookie("refresh_token");
    res.json({ success: true });
  });

  // ── Runs ─────────────────────────────────────────────────────────────────────

  // POST /api/runs/from-prompt — generate DOT from plain-text prompt via LLM, then start run
  const PIPELINE_SYSTEM_PROMPT = `You are a pipeline architect. Convert the user's description into a valid Graphviz DOT pipeline definition for an autonomous coding agent.

Rules:
- Use digraph with a descriptive graph ID (no spaces)
- Include: graph [goal="..."] with a concise goal
- Start node: shape=Mdiamond, label="Start"
- End node: shape=Msquare, label="Done"
- Intermediate nodes: shape=box, type="agent", with a prompt="..." that is a direct imperative instruction for an autonomous coding agent — specific, actionable, e.g. "Find all files containing 'New Pipeline' and replace every occurrence with 'Agent'" not "rename the tab"
- Use 1–4 intermediate nodes appropriate to the task — don't over-decompose simple tasks
- Connect nodes with edges: Start -> node1 -> node2 -> Done

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
    res.json({ model: settings.model, workspaceRoot: settings.workspaceRoot, models: OPENROUTER_MODELS });
  });

  // PATCH /api/settings — update model and/or workspaceRoot
  app.patch("/api/settings", (req, res) => {
    const { model, workspaceRoot } = req.body as { model?: string; workspaceRoot?: string };
    if (!model && !workspaceRoot) return res.status(400).json({ error: "model or workspaceRoot is required" });
    if (model) settings.model = model;
    if (workspaceRoot) settings.workspaceRoot = workspaceRoot;
    res.json({ model: settings.model, workspaceRoot: settings.workspaceRoot });
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
