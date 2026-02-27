// Node handlers for Attractor pipeline

import { promises as fs } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Outcome, PipelineContext } from "./types.js";
import type { GraphNode, ParsedGraph } from "./parser/dot.js";
import { getOutgoingEdges, resolveHandlerType } from "./parser/dot.js";
import { parseAcceleratorKey, normalizeLabel } from "./conditions.js";
import type { Client } from "../llm/client.js";
import { Message } from "../llm/client.js";
import type { PipelineEvent, HumanChoice } from "./types.js";
import { AgentHandler } from "./agent_handler.js";

const execFileAsync = promisify(execFile);

export interface Handler {
  execute(
    node: GraphNode,
    context: PipelineContext,
    graph: ParsedGraph,
    logsRoot: string,
    emit: (event: PipelineEvent) => void,
    runId: string,
  ): Promise<Outcome>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await fs.writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

function expandVariables(text: string, graph: ParsedGraph, context: PipelineContext): string {
  return text.replace(/\$goal/g, graph.attrs.goal ?? "");
}

function parseDurationMs(duration: string | undefined): number {
  if (!duration) return 900_000; // 15 min default
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 900_000;
  const [, numStr, unit] = match;
  const num = parseInt(numStr);
  const mult: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return num * (mult[unit] ?? 1000);
}

// ─── Start Handler ────────────────────────────────────────────────────────────

export class StartHandler implements Handler {
  async execute(): Promise<Outcome> {
    return { status: "SUCCESS", notes: "Pipeline started" };
  }
}

// ─── Exit Handler ─────────────────────────────────────────────────────────────

export class ExitHandler implements Handler {
  async execute(): Promise<Outcome> {
    return { status: "SUCCESS", notes: "Pipeline completed" };
  }
}

// ─── Conditional Handler ──────────────────────────────────────────────────────

export class ConditionalHandler implements Handler {
  async execute(node: GraphNode): Promise<Outcome> {
    return {
      status: "SUCCESS",
      notes: `Conditional node evaluated: ${node.id}`,
    };
  }
}

// ─── Codergen Handler ─────────────────────────────────────────────────────────

export interface CodergenBackend {
  run(node: GraphNode, prompt: string, context: PipelineContext): Promise<string | Outcome>;
}

export class LLMBackend implements CodergenBackend {
  constructor(private client: Client, private model: string) {}

  async run(node: GraphNode, prompt: string, context: PipelineContext): Promise<string> {
    const model = node.attrs.llmModel ?? this.model;
    const response = await this.client.complete({
      model,
      messages: [
        Message.system(
          `You are an AI assistant executing a pipeline stage.\nContext goal: ${context.getString("graph.goal")}`,
        ),
        Message.user(prompt),
      ],
      reasoningEffort: (node.attrs.reasoningEffort as "low" | "medium" | "high" | undefined) ?? "high",
    });
    return response.message.content
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join("");
  }
}

export class SimulationBackend implements CodergenBackend {
  async run(node: GraphNode, prompt: string): Promise<string> {
    return `[Simulated] Response for stage: ${node.id}\nPrompt: ${prompt.slice(0, 100)}...`;
  }
}

export class CodergenHandler implements Handler {
  constructor(private backend: CodergenBackend) {}

  async execute(
    node: GraphNode,
    context: PipelineContext,
    graph: ParsedGraph,
    logsRoot: string,
    emit: (event: PipelineEvent) => void,
    runId: string,
  ): Promise<Outcome> {
    let prompt = node.attrs.prompt || node.attrs.label || node.id;
    prompt = expandVariables(prompt, graph, context);

    const stageDir = join(logsRoot, node.id);
    await ensureDir(stageDir);
    await fs.writeFile(join(stageDir, "prompt.md"), prompt, "utf-8");

    let responseText: string;
    try {
      const result = await this.backend.run(node, prompt, context);
      if (typeof result !== "string") {
        await writeJson(join(stageDir, "status.json"), result);
        return result;
      }
      responseText = result;
    } catch (err) {
      return { status: "FAIL", failureReason: String(err) };
    }

    await fs.writeFile(join(stageDir, "response.md"), responseText, "utf-8");

    const outcome: Outcome = {
      status: "SUCCESS",
      notes: `Stage completed: ${node.id}`,
      contextUpdates: {
        last_stage: node.id,
        last_response: responseText.slice(0, 200),
      },
    };

    await writeJson(join(stageDir, "status.json"), outcome);
    return outcome;
  }
}

// ─── Wait For Human Handler ────────────────────────────────────────────────────

export class WaitForHumanHandler implements Handler {
  // Pending answers: runId+nodeId -> resolve function
  private static pendingGates = new Map<string, (answer: string) => void>();

  static submitAnswer(runId: string, nodeId: string, answer: string): boolean {
    const key = `${runId}:${nodeId}`;
    const resolve = WaitForHumanHandler.pendingGates.get(key);
    if (resolve) {
      WaitForHumanHandler.pendingGates.delete(key);
      resolve(answer);
      return true;
    }
    return false;
  }

  async execute(
    node: GraphNode,
    context: PipelineContext,
    graph: ParsedGraph,
    logsRoot: string,
    emit: (event: PipelineEvent) => void,
    runId: string,
  ): Promise<Outcome> {
    const edges = getOutgoingEdges(graph, node.id);
    if (edges.length === 0) {
      return { status: "FAIL", failureReason: "No outgoing edges for human gate" };
    }

    const choices: HumanChoice[] = edges.map((edge) => {
      const label = edge.attrs.label ?? edge.to;
      return {
        key: parseAcceleratorKey(label),
        label,
        toNode: edge.to,
      };
    });

    emit({
      type: "HUMAN_GATE",
      runId,
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      humanChoices: choices,
      message: node.attrs.label ?? "Select an option:",
    });

    // Wait for human answer
    const timeoutMs = parseDurationMs(node.attrs.timeout) || 3_600_000; // 1 hour default

    const answer = await Promise.race([
      new Promise<string>((resolve) => {
        WaitForHumanHandler.pendingGates.set(`${runId}:${node.id}`, resolve);
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    WaitForHumanHandler.pendingGates.delete(`${runId}:${node.id}`);

    if (answer === null) {
      const defaultChoice = node.attrs.humanDefaultChoice;
      if (defaultChoice) {
        return {
          status: "SUCCESS",
          suggestedNextIds: [defaultChoice],
          contextUpdates: { "human.gate.selected": defaultChoice, "human.gate.label": "timeout default" },
        };
      }
      return { status: "RETRY", failureReason: "Human gate timeout, no default" };
    }

    // Find the matching choice
    const normalizedAnswer = normalizeLabel(answer);
    let selected = choices.find((c) => normalizeLabel(c.label) === normalizedAnswer);
    if (!selected) {
      selected = choices.find((c) => c.key.toLowerCase() === answer.toLowerCase());
    }
    if (!selected) selected = choices[0];

    emit({
      type: "HUMAN_ANSWER",
      runId,
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      humanAnswer: answer,
    });

    return {
      status: "SUCCESS",
      suggestedNextIds: [selected.toNode],
      contextUpdates: {
        "human.gate.selected": selected.key,
        "human.gate.label": selected.label,
      },
    };
  }
}

// ─── Tool Handler ──────────────────────────────────────────────────────────────

export class ToolHandler implements Handler {
  async execute(
    node: GraphNode,
    context: PipelineContext,
    graph: ParsedGraph,
    logsRoot: string,
  ): Promise<Outcome> {
    const command = node.attrs.toolCommand;
    if (!command) {
      return { status: "FAIL", failureReason: "No tool_command specified" };
    }

    const timeoutMs = parseDurationMs(node.attrs.timeout) || 30_000;

    try {
      const { stdout } = await execFileAsync("bash", ["-c", command], {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        status: "SUCCESS",
        contextUpdates: { "tool.output": stdout },
        notes: `Tool completed: ${command.slice(0, 80)}`,
      };
    } catch (err) {
      return { status: "FAIL", failureReason: String(err) };
    }
  }
}

// ─── Parallel Handler ──────────────────────────────────────────────────────────

export class ParallelHandler implements Handler {
  async execute(
    node: GraphNode,
    context: PipelineContext,
    graph: ParsedGraph,
    logsRoot: string,
    emit: (event: PipelineEvent) => void,
    runId: string,
  ): Promise<Outcome> {
    // Parallel execution is complex; stub returns SUCCESS and records branch IDs
    const branches = getOutgoingEdges(graph, node.id);
    const branchIds = branches.map((e) => e.to);

    context.set("parallel.branch_ids", branchIds);
    context.set("parallel.results", JSON.stringify([]));

    return {
      status: "SUCCESS",
      notes: `Parallel fan-out to: ${branchIds.join(", ")}`,
      suggestedNextIds: branchIds.length > 0 ? [branchIds[0]] : undefined,
    };
  }
}

// ─── Fan-In Handler ────────────────────────────────────────────────────────────

export class FanInHandler implements Handler {
  async execute(
    node: GraphNode,
    context: PipelineContext,
  ): Promise<Outcome> {
    const rawResults = context.getString("parallel.results", "[]");
    let results: unknown[] = [];
    try { results = JSON.parse(rawResults); } catch { results = []; }

    if (results.length === 0) {
      return {
        status: "SUCCESS",
        notes: "Fan-in: no parallel results found, continuing",
        contextUpdates: { "parallel.fan_in.best_id": "none" },
      };
    }

    return {
      status: "SUCCESS",
      notes: `Fan-in: consolidated ${results.length} results`,
      contextUpdates: { "parallel.fan_in.count": results.length },
    };
  }
}

// ─── Manager Loop Handler ──────────────────────────────────────────────────────

export class ManagerLoopHandler implements Handler {
  async execute(
    node: GraphNode,
    context: PipelineContext,
  ): Promise<Outcome> {
    // Simplified manager loop that checks child status from context
    const stopCondition = node.attrs.managerStopCondition;
    const maxCycles = node.attrs.managerMaxCycles ?? 1000;
    const pollIntervalMs = parseDurationMs(node.attrs.managerPollInterval ?? "45s");
    let cycles = 0;

    while (cycles < maxCycles) {
      const childStatus = context.getString("context.stack.child.status", "");
      if (childStatus === "completed") {
        const childOutcome = context.getString("context.stack.child.outcome", "");
        if (childOutcome === "success") {
          return { status: "SUCCESS", notes: "Child pipeline completed successfully" };
        }
        return { status: "FAIL", failureReason: "Child pipeline failed" };
      }
      if (childStatus === "failed") {
        return { status: "FAIL", failureReason: "Child pipeline failed" };
      }

      if (stopCondition && context.getString(stopCondition)) {
        return { status: "SUCCESS", notes: "Stop condition satisfied" };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
      cycles++;
    }

    return { status: "FAIL", failureReason: "Manager loop: max cycles exceeded" };
  }
}

// ─── Handler Registry ──────────────────────────────────────────────────────────

export class HandlerRegistry {
  private handlers = new Map<string, Handler>();
  defaultHandler: Handler;

  constructor(defaultHandler: Handler) {
    this.defaultHandler = defaultHandler;
  }

  register(type: string, handler: Handler): void {
    this.handlers.set(type, handler);
  }

  resolve(node: GraphNode): Handler {
    const type = resolveHandlerType(node);
    return this.handlers.get(type) ?? this.defaultHandler;
  }
}

export function createDefaultRegistry(
  backend: CodergenBackend,
  agentClient?: Client,
  agentModel?: string,
  workspaceRoot?: string,
): HandlerRegistry {
  const codergen = new CodergenHandler(backend);
  const registry = new HandlerRegistry(codergen);

  registry.register("start", new StartHandler());
  registry.register("exit", new ExitHandler());
  registry.register("codergen", codergen);
  registry.register("conditional", new ConditionalHandler());
  registry.register("wait.human", new WaitForHumanHandler());
  registry.register("tool", new ToolHandler());
  registry.register("parallel", new ParallelHandler());
  registry.register("parallel.fan_in", new FanInHandler());
  registry.register("stack.manager_loop", new ManagerLoopHandler());

  // Register AgentHandler if LLM client is available
  if (agentClient && agentModel && workspaceRoot) {
    registry.register("agent", new AgentHandler(agentClient, agentModel, workspaceRoot));
  }

  return registry;
}
