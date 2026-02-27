// Pipeline Execution Engine

import { promises as fs } from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";
import { parseDot, findStartNode, getOutgoingEdges } from "./parser/dot.js";
import { Context } from "./context.js";
import { evaluateCondition, normalizeLabel } from "./conditions.js";
import type { HandlerRegistry } from "./handlers.js";
import { WaitForHumanHandler } from "./handlers.js";
import type { Outcome, PipelineRun, PipelineEvent, Checkpoint } from "./types.js";
import type { ParsedGraph, GraphNode, GraphEdge } from "./parser/dot.js";
import type { PipelineContext } from "./types.js";
import { loadRuns as loadPersistedRuns, scheduleSave } from "../store/persist.js";

const LOGS_BASE = process.env.ATTRACTOR_LOGS_DIR ?? "./logs";

// ─── Edge Selection ────────────────────────────────────────────────────────────

function selectEdge(
  nodeId: string,
  outcome: Outcome,
  context: PipelineContext,
  graph: ParsedGraph,
): GraphEdge | null {
  const edges = getOutgoingEdges(graph, nodeId);
  if (edges.length === 0) return null;

  // Step 1: Condition-matching edges
  const conditionMatched = edges.filter(
    (e) => e.attrs.condition && evaluateCondition(e.attrs.condition, outcome, context),
  );
  if (conditionMatched.length > 0) {
    return bestByWeightThenLexical(conditionMatched);
  }

  // Step 2: Preferred label match
  if (outcome.preferredLabel) {
    const normalizedPref = normalizeLabel(outcome.preferredLabel);
    const labelMatch = edges.find(
      (e) => e.attrs.label && normalizeLabel(e.attrs.label) === normalizedPref,
    );
    if (labelMatch) return labelMatch;
  }

  // Step 3: Suggested next IDs
  if (outcome.suggestedNextIds && outcome.suggestedNextIds.length > 0) {
    for (const suggestedId of outcome.suggestedNextIds) {
      const found = edges.find((e) => e.to === suggestedId);
      if (found) return found;
    }
  }

  // Step 4 & 5: Weight + lexical tiebreak (unconditional edges only)
  const unconditional = edges.filter((e) => !e.attrs.condition);
  if (unconditional.length > 0) {
    return bestByWeightThenLexical(unconditional);
  }

  return bestByWeightThenLexical(edges);
}

function bestByWeightThenLexical(edges: GraphEdge[]): GraphEdge {
  return [...edges].sort((a, b) => {
    const wA = a.attrs.weight ?? 0;
    const wB = b.attrs.weight ?? 0;
    if (wB !== wA) return wB - wA;
    return a.to.localeCompare(b.to);
  })[0];
}

// ─── Goal Gate Enforcement ─────────────────────────────────────────────────────

function checkGoalGates(
  graph: ParsedGraph,
  nodeOutcomes: Record<string, Outcome>,
): { ok: boolean; failedGate?: GraphNode } {
  for (const [nodeId, outcome] of Object.entries(nodeOutcomes)) {
    const node = graph.nodes.get(nodeId);
    if (node?.attrs.goalGate) {
      if (outcome.status !== "SUCCESS" && outcome.status !== "PARTIAL_SUCCESS") {
        return { ok: false, failedGate: node };
      }
    }
  }
  return { ok: true };
}

// ─── Retry Policy ──────────────────────────────────────────────────────────────

interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  jitter: boolean;
}

function buildRetryPolicy(node: GraphNode, graph: ParsedGraph): RetryPolicy {
  const maxRetries = node.attrs.maxRetries ?? graph.attrs.defaultMaxRetry ?? 0;
  return {
    maxAttempts: maxRetries + 1,
    initialDelayMs: 200,
    backoffFactor: 2.0,
    maxDelayMs: 60_000,
    jitter: true,
  };
}

function delayForAttempt(attempt: number, policy: RetryPolicy): number {
  let delay = policy.initialDelayMs * Math.pow(policy.backoffFactor, attempt - 1);
  delay = Math.min(delay, policy.maxDelayMs);
  if (policy.jitter) {
    delay *= 0.5 + Math.random();
  }
  return delay;
}

// ─── Checkpoint ────────────────────────────────────────────────────────────────

async function saveCheckpoint(
  runId: string,
  logsRoot: string,
  currentNode: string,
  completedNodes: string[],
  nodeRetries: Record<string, number>,
  context: PipelineContext,
): Promise<Checkpoint> {
  const checkpoint: Checkpoint = {
    timestamp: new Date().toISOString(),
    currentNode,
    completedNodes: [...completedNodes],
    nodeRetries: { ...nodeRetries },
    contextValues: context.snapshot(),
    logs: [...context.logs],
  };
  await fs.writeFile(
    join(logsRoot, "checkpoint.json"),
    JSON.stringify(checkpoint, null, 2),
    "utf-8",
  );
  return checkpoint;
}

// ─── Engine ────────────────────────────────────────────────────────────────────

export class PipelineEngine {
  private runs = new Map<string, PipelineRun>();
  private eventListeners = new Map<string, Array<(event: PipelineEvent) => void>>();

  constructor(private registry: HandlerRegistry) {}

  /** Load persisted runs from disk. Call once at startup. */
  async init(): Promise<void> {
    this.runs = await loadPersistedRuns();
  }

  private persist(): void {
    scheduleSave(this.runs);
  }

  subscribe(runId: string, listener: (event: PipelineEvent) => void): () => void {
    const listeners = this.eventListeners.get(runId) ?? [];
    listeners.push(listener);
    this.eventListeners.set(runId, listeners);
    return () => {
      const current = this.eventListeners.get(runId) ?? [];
      this.eventListeners.set(
        runId,
        current.filter((l) => l !== listener),
      );
    };
  }

  private emit(event: PipelineEvent): void {
    const listeners = this.eventListeners.get(event.runId) ?? [];
    for (const listener of listeners) {
      try { listener(event); } catch { /* ignore listener errors */ }
    }
  }

  getRun(runId: string): PipelineRun | undefined {
    return this.runs.get(runId);
  }

  getAllRuns(): PipelineRun[] {
    return Array.from(this.runs.values());
  }

  async start(dotSource: string): Promise<PipelineRun> {
    const runId = uuid();
    const logsRoot = join(LOGS_BASE, runId);
    await fs.mkdir(logsRoot, { recursive: true });

    // Parse
    let graph: ParsedGraph;
    try {
      graph = parseDot(dotSource);
    } catch (err) {
      const run: PipelineRun = {
        id: runId,
        dotSource,
        graphId: "unknown",
        graphGoal: "",
        status: "FAILED",
        completedNodes: [],
        nodeOutcomes: {},
        startedAt: new Date().toISOString(),
        logsRoot,
        error: `Parse error: ${err}`,
      };
      this.runs.set(runId, run);
      this.persist();
      return run;
    }

    await fs.writeFile(join(logsRoot, "pipeline.dot"), dotSource, "utf-8");

    const run: PipelineRun = {
      id: runId,
      dotSource,
      graphId: graph.id,
      graphGoal: graph.attrs.goal ?? "",
      status: "INITIALIZE",
      completedNodes: [],
      nodeOutcomes: {},
      startedAt: new Date().toISOString(),
      logsRoot,
    };
    this.runs.set(runId, run);
    this.persist();

    // Execute asynchronously
    this.executeRun(runId, graph, logsRoot).catch((err) => {
      const r = this.runs.get(runId);
      if (r) {
        r.status = "FAILED";
        r.error = String(err);
        r.completedAt = new Date().toISOString();
        this.persist();
      }
    });

    return run;
  }

  private async executeRun(
    runId: string,
    graph: ParsedGraph,
    logsRoot: string,
  ): Promise<void> {
    const run = this.runs.get(runId)!;
    const context = new Context();
    const nodeRetries: Record<string, number> = {};
    const nodeOutcomes: Record<string, Outcome> = {};
    const completedNodes: string[] = [];

    // Mirror graph attributes into context
    context.set("graph.goal", graph.attrs.goal ?? "");

    const startNode = findStartNode(graph);
    if (!startNode) {
      run.status = "FAILED";
      run.error = "No start node found (shape=Mdiamond or id=start)";
      run.completedAt = new Date().toISOString();
      this.persist();
      return;
    }

    run.status = "EXECUTE";
    let currentNode = startNode;

    const isTerminal = (node: GraphNode) => node.attrs.shape === "Msquare" || node.id.toLowerCase() === "exit";

    while (true) {
      run.currentNode = currentNode.id;
      context.set("current_node", currentNode.id);

      this.emit({
        type: "NODE_START",
        runId,
        timestamp: new Date().toISOString(),
        nodeId: currentNode.id,
      });

      // Terminal node check
      if (isTerminal(currentNode)) {
        const { ok, failedGate } = checkGoalGates(graph, nodeOutcomes);
        if (!ok && failedGate) {
          const retryTarget = failedGate.attrs.retryTarget
            ?? failedGate.attrs.fallbackRetryTarget
            ?? graph.attrs.retryTarget
            ?? graph.attrs.fallbackRetryTarget;
          if (retryTarget && graph.nodes.has(retryTarget)) {
            currentNode = graph.nodes.get(retryTarget)!;
            continue;
          } else {
            run.status = "FAILED";
            run.error = `Goal gate unsatisfied for ${failedGate.id} and no retry target`;
            run.completedAt = new Date().toISOString();
            this.persist();
            return;
          }
        }
        break;
      }

      // Execute with retry
      const retryPolicy = buildRetryPolicy(currentNode, graph);
      let outcome: Outcome = { status: "FAIL", failureReason: "Not executed" };

      for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
        try {
          const handler = this.registry.resolve(currentNode);
          outcome = await handler.execute(
            currentNode,
            context,
            graph,
            logsRoot,
            this.emit.bind(this),
            runId,
          );
        } catch (err) {
          if (attempt < retryPolicy.maxAttempts) {
            await new Promise((r) => setTimeout(r, delayForAttempt(attempt, retryPolicy)));
            continue;
          }
          outcome = { status: "FAIL", failureReason: String(err) };
        }

        if (outcome.status === "SUCCESS" || outcome.status === "PARTIAL_SUCCESS") {
          nodeRetries[currentNode.id] = 0;
          break;
        }

        if (outcome.status === "RETRY") {
          nodeRetries[currentNode.id] = (nodeRetries[currentNode.id] ?? 0) + 1;
          if (attempt < retryPolicy.maxAttempts) {
            await new Promise((r) => setTimeout(r, delayForAttempt(attempt, retryPolicy)));
            continue;
          }
          if (currentNode.attrs.allowPartial) {
            outcome = { status: "PARTIAL_SUCCESS", notes: "Retries exhausted, partial accepted" };
          } else {
            outcome = { status: "FAIL", failureReason: "Max retries exceeded" };
          }
          break;
        }

        if (outcome.status === "FAIL") break;
      }

      // Record completion
      completedNodes.push(currentNode.id);
      nodeOutcomes[currentNode.id] = outcome;
      run.completedNodes = [...completedNodes];
      run.nodeOutcomes = { ...nodeOutcomes };
      this.persist();

      this.emit({
        type: outcome.status === "FAIL" ? "NODE_FAIL" : "NODE_COMPLETE",
        runId,
        timestamp: new Date().toISOString(),
        nodeId: currentNode.id,
        outcome,
      });

      // Apply context updates
      if (outcome.contextUpdates) {
        context.applyUpdates(outcome.contextUpdates);
      }
      context.set("outcome", outcome.status.toLowerCase());
      if (outcome.preferredLabel) {
        context.set("preferred_label", outcome.preferredLabel);
      }

      // Save checkpoint
      await saveCheckpoint(runId, logsRoot, currentNode.id, completedNodes, nodeRetries, context);

      // Select next edge
      const nextEdge = selectEdge(currentNode.id, outcome, context, graph);

      if (!nextEdge) {
        if (outcome.status === "FAIL") {
          // Check for retry target on node or graph level
          const retryTarget = currentNode.attrs.retryTarget ?? graph.attrs.retryTarget;
          if (retryTarget && graph.nodes.has(retryTarget)) {
            currentNode = graph.nodes.get(retryTarget)!;
            continue;
          }
          run.status = "FAILED";
          run.error = `Stage ${currentNode.id} failed with no outgoing edge`;
          run.completedAt = new Date().toISOString();
          this.persist();
          return;
        }
        break;
      }

      // Loop restart
      if (nextEdge.attrs.loopRestart) {
        // Re-launch the run
        const newRun = await this.start(run.dotSource);
          run.status = "COMPLETED";
          run.completedAt = new Date().toISOString();
          run.notes = `Restarted as ${newRun.id}`;
          this.persist();
          return;
      }

      this.emit({
        type: "EDGE_SELECTED",
        runId,
        timestamp: new Date().toISOString(),
        nodeId: currentNode.id,
        edgeLabel: nextEdge.attrs.label ?? nextEdge.to,
      });

      const nextNode = graph.nodes.get(nextEdge.to);
      if (!nextNode) {
        run.status = "FAILED";
        run.error = `Target node not found: ${nextEdge.to}`;
        run.completedAt = new Date().toISOString();
        this.persist();
        return;
      }

      currentNode = nextNode;
    }

    run.status = "COMPLETED";
    run.completedAt = new Date().toISOString();
    run.currentNode = undefined;
    this.persist();

    this.emit({
      type: "STATUS_CHANGE",
      runId,
      timestamp: new Date().toISOString(),
      message: "Pipeline completed",
    });
  }

  submitHumanAnswer(runId: string, nodeId: string, answer: string): boolean {
    return WaitForHumanHandler.submitAnswer(runId, nodeId, answer);
  }
}
