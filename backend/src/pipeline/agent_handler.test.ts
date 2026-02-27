// Tests for AgentHandler — mocks the LLM client, uses a real temp workspace

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { AgentHandler } from "./agent_handler.js";
import type { Client, Message as LLMMessage } from "../llm/client.js";
import { Message } from "../llm/client.js";
import type { PipelineContext, PipelineEvent } from "./types.js";
import type { GraphNode, ParsedGraph } from "./parser/dot.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(): PipelineContext {
  const values = new Map<string, unknown>();
  return {
    values,
    logs: [],
    get: (k, d?) => values.get(k) ?? d,
    getString: (k, d = "") => String(values.get(k) ?? d),
    set: (k, v) => { values.set(k, v); },
    applyUpdates: (u) => { for (const [k, v] of Object.entries(u)) values.set(k, v); },
    snapshot: () => Object.fromEntries(values),
    clone: () => makeContext(),
    appendLog: () => {},
  };
}

function makeNode(id: string, prompt: string): GraphNode {
  return {
    id,
    attrs: { prompt, label: id, type: "agent" },
  };
}

function makeGraph(): ParsedGraph {
  return {
    id: "test-graph",
    attrs: { goal: "test goal", id: "test-graph" },
    nodes: new Map(),
    edges: [],
  };
}

function makeEmit() {
  const events: PipelineEvent[] = [];
  const emit = (e: PipelineEvent) => events.push(e);
  return { events, emit };
}

// ── Mock Client factory ───────────────────────────────────────────────────────

function makeMockClient(responses: Array<{
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}>): Client {
  let callCount = 0;

  return {
    complete: vi.fn(async () => {
      const resp = responses[Math.min(callCount, responses.length - 1)];
      callCount++;

      if (resp.toolCalls && resp.toolCalls.length > 0) {
        const content = resp.toolCalls.map((tc) => ({
          kind: "tool_call" as const,
          toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments, type: "function" },
        }));
        if (resp.text) content.unshift({ kind: "text" as const, toolCall: undefined as never, text: resp.text } as never);
        return {
          message: { role: "assistant" as const, content } as LLMMessage,
          finishReason: { reason: "tool_calls" as const },
          usage: { input: 0, output: 0, total: 0 },
        };
      }

      return {
        message: Message.assistant(resp.text ?? "Done."),
        finishReason: { reason: "stop" as const },
        usage: { input: 0, output: 0, total: 0 },
      };
    }),
  } as unknown as Client;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let dir: string;
let logsDir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "maxtory-agent-ws-"));
  logsDir = await fs.mkdtemp(join(tmpdir(), "maxtory-agent-logs-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(logsDir, { recursive: true, force: true });
});

describe("AgentHandler", () => {
  it("runs a single stop turn and returns SUCCESS", async () => {
    const client = makeMockClient([{ text: "All done!" }]);
    const handler = new AgentHandler(client, "test-model", dir);
    const { emit, events } = makeEmit();

    const outcome = await handler.execute(
      makeNode("build", "Write a hello world file"),
      makeContext(),
      makeGraph(),
      logsDir,
      emit,
      "run-001",
    );

    expect(outcome.status).toBe("SUCCESS");
    expect(outcome.notes).toContain("build");
  });

  it("writes prompt.md and response.md to logsDir/nodeId", async () => {
    const client = makeMockClient([{ text: "I wrote the file." }]);
    const handler = new AgentHandler(client, "test-model", dir);
    const { emit } = makeEmit();

    await handler.execute(
      makeNode("step1", "Create README"),
      makeContext(),
      makeGraph(),
      logsDir,
      emit,
      "run-002",
    );

    const prompt = await fs.readFile(join(logsDir, "step1", "prompt.md"), "utf-8");
    expect(prompt).toBe("Create README");

    const response = await fs.readFile(join(logsDir, "step1", "response.md"), "utf-8");
    expect(response).toBe("I wrote the file.");
  });

  it("executes a tool call and writes tool_calls.jsonl", async () => {
    // First turn: LLM calls write_file
    // Second turn: LLM says done
    const client = makeMockClient([
      {
        toolCalls: [{
          id: "call-1",
          name: "write_file",
          arguments: { path: "hello.txt", content: "Hello, world!" },
        }],
      },
      { text: "File written." },
    ]);
    const handler = new AgentHandler(client, "test-model", dir);
    const { emit, events } = makeEmit();

    const outcome = await handler.execute(
      makeNode("write_node", "Write hello.txt"),
      makeContext(),
      makeGraph(),
      logsDir,
      emit,
      "run-003",
    );

    expect(outcome.status).toBe("SUCCESS");

    // File should have been created in workspace
    const content = await fs.readFile(join(dir, "hello.txt"), "utf-8");
    expect(content).toBe("Hello, world!");

    // tool_calls.jsonl should exist
    const jsonl = await fs.readFile(join(logsDir, "write_node", "tool_calls.jsonl"), "utf-8");
    const record = JSON.parse(jsonl.trim());
    expect(record.name).toBe("write_file");
    expect(record.isError).toBe(false);
  });

  it("records isError=true for an unknown tool", async () => {
    const client = makeMockClient([
      {
        toolCalls: [{
          id: "call-x",
          name: "unknown_tool",
          arguments: {},
        }],
      },
      { text: "Gave up." },
    ]);
    const handler = new AgentHandler(client, "test-model", dir);
    const { emit } = makeEmit();

    await handler.execute(
      makeNode("bad_node", "Use bad tool"),
      makeContext(),
      makeGraph(),
      logsDir,
      emit,
      "run-004",
    );

    const jsonl = await fs.readFile(join(logsDir, "bad_node", "tool_calls.jsonl"), "utf-8");
    const record = JSON.parse(jsonl.trim());
    expect(record.isError).toBe(true);
    expect(record.result).toContain("Unknown tool");
  });

  it("emits LOG events for each tool call", async () => {
    const client = makeMockClient([
      {
        toolCalls: [{
          id: "call-2",
          name: "write_file",
          arguments: { path: "x.txt", content: "x" },
        }],
      },
      { text: "Done." },
    ]);
    const handler = new AgentHandler(client, "test-model", dir);
    const { emit, events } = makeEmit();

    await handler.execute(
      makeNode("node1", "task"),
      makeContext(),
      makeGraph(),
      logsDir,
      emit,
      "run-005",
    );

    const logEvents = events.filter((e) => e.type === "LOG");
    expect(logEvents.length).toBeGreaterThan(0);
    expect(logEvents[0].message).toContain("write_file");
  });

  it("returns FAIL when max tool calls is exceeded", async () => {
    // Every turn returns a tool call → infinite loop hits cap
    const infiniteToolCall = {
      toolCalls: [{
        id: "call-inf",
        name: "write_file",
        arguments: { path: "x.txt", content: "x" },
      }],
    };
    // Return tool calls every time (client will keep returning same response)
    const client = makeMockClient(Array(50).fill(infiniteToolCall));
    const handler = new AgentHandler(client, "test-model", dir);
    const { emit } = makeEmit();

    const outcome = await handler.execute(
      // Override maxToolCalls to 2 via node attrs
      { id: "loop_node", attrs: { prompt: "loop", maxToolCalls: "2" } },
      makeContext(),
      makeGraph(),
      logsDir,
      emit,
      "run-006",
    );

    expect(outcome.status).toBe("FAIL");
    expect(outcome.failureReason).toContain("max tool calls");
  });
});
