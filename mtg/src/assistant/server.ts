// MTG Commander Assistant — HTTP server.
//
// Port: 3002 (configurable via PORT env var or MTG_PORT)
//
// Endpoints:
//   POST /api/chat              — start or continue a conversation (SSE stream)
//   GET  /api/chat/:sessionId   — get session info + history
//   DELETE /api/chat/:sessionId — clear a session
//   GET  /api/health            — health check
//
// SSE event format (POST /api/chat):
//   data: {"type":"intent",   "data": { intent object }}
//   data: {"type":"retrieved","data": { cardCount, comboCount }}
//   data: {"type":"token",    "data": "partial text"}
//   data: {"type":"done",     "data": { sessionId, fullText }}
//   data: {"type":"error",    "data": "error message"}

import "dotenv/config";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { warmCache } from "./vector.js";
import { classifyIntent } from "./intent.js";
import { retrieve } from "./retrieve.js";
import { buildContext, buildSystemPrompt } from "./context.js";
import { streamAnswer } from "./answer.js";
import {
  getOrCreateSession,
  getSession,
  deleteSession,
  addUserMessage,
  addAssistantMessage,
  sessionSnapshot,
} from "./conversation.js";

const PORT = parseInt(process.env.MTG_PORT ?? process.env.PORT ?? "3002");

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: "512kb" }));

// ── POST /api/chat ─────────────────────────────────────────────────────────────

app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body as {
    message?: string;
    sessionId?: string;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  function send(type: string, data: unknown): void {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  }

  const session = getOrCreateSession(sessionId);
  addUserMessage(session, message.trim());

  try {
    // Step 1: classify intent
    const intent = await classifyIntent(message.trim(), session.history.slice(0, -1));
    send("intent", intent);

    // Step 2: retrieve relevant data
    const result = await retrieve(intent);
    send("retrieved", {
      cardCount: result.cards.length,
      comboCount: result.combos.length,
      hasEmbeddings: result.hasEmbeddings,
    });

    // Step 3: build context block
    const context = buildContext(result, intent);
    const systemPrompt = buildSystemPrompt(intent);

    // Step 4: stream the answer
    let fullText = "";
    await streamAnswer(
      systemPrompt,
      context,
      session.history.slice(0, -1), // history without the current user message
      message.trim(),
      {
        onToken: (token) => {
          fullText += token;
          send("token", token);
        },
        onDone: (text) => {
          fullText = text;
        },
        onError: (err) => {
          send("error", err.message);
        },
      }
    );

    // Store the assistant response in history
    addAssistantMessage(session, fullText);

    send("done", { sessionId: session.id, fullText });
  } catch (err) {
    send("error", err instanceof Error ? err.message : String(err));
  } finally {
    res.end();
  }
});

// ── GET /api/chat/:sessionId ──────────────────────────────────────────────────

app.get("/api/chat/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({
    ...sessionSnapshot(session),
    history: session.history,
  });
});

// ── DELETE /api/chat/:sessionId ───────────────────────────────────────────────

app.delete("/api/chat/:sessionId", (req, res) => {
  const deleted = deleteSession(req.params.sessionId);
  res.json({ deleted });
});

// ── GET /api/health ───────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), service: "mtg-assistant" });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const httpServer = createServer(app);

httpServer.listen(PORT, () => {
  console.log(`MTG Assistant running on http://localhost:${PORT}`);
  console.log(`POST http://localhost:${PORT}/api/chat  { message, sessionId? }`);
  console.log();

  // Warm the vector cache in the background after startup
  setTimeout(() => {
    try {
      warmCache();
    } catch (err) {
      // No embeddings yet — user needs to run embed:cards first
      console.warn("[vector] No embeddings loaded — run `npm run embed:cards` to enable semantic search.");
    }
  }, 500);
});
