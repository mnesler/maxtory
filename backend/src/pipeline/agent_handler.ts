// AgentHandler — agentic tool-use loop for autonomous coding tasks

import { promises as fs } from "fs";
import { join } from "path";
import type { Outcome, PipelineContext } from "./types.js";
import type { GraphNode, ParsedGraph } from "./parser/dot.js";
import type { Client, Message as LLMMessage } from "../llm/client.js";
import { Message } from "../llm/client.js";
import type { PipelineEvent } from "./types.js";
import { buildToolDefinitions, findTool } from "../tools/index.js";
import { listDirTool } from "../tools/list_dir.js";

const DEFAULT_MAX_TOOL_CALLS = 30;

interface ToolCallRecord {
  turn: number;
  toolCallId: string;
  name: string;
  args: unknown;
  result: string;
  isError: boolean;
}

async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

function expandVariables(text: string, graph: ParsedGraph, context: PipelineContext): string {
  return text.replace(/\$goal/g, graph.attrs.goal ?? "");
}

export class AgentHandler {
  constructor(
    private client: Client,
    private model: string,
    private workspaceRoot: string,
  ) {}

  async execute(
    node: GraphNode,
    context: PipelineContext,
    graph: ParsedGraph,
    logsRoot: string,
    emit: (event: PipelineEvent) => void,
    runId: string,
  ): Promise<Outcome> {
    let task = node.attrs.prompt || node.attrs.label || node.id;
    task = expandVariables(task, graph, context);

    const stageDir = join(logsRoot, node.id);
    await ensureDir(stageDir);
    await fs.writeFile(join(stageDir, "prompt.md"), task, "utf-8");

    const model = (node.attrs.llmModel as string | undefined) ?? this.model;
    const maxToolCalls = parseInt(String(node.attrs.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS));

    // Build initial workspace context for system prompt
    let workspaceSummary = "";
    try {
      workspaceSummary = await listDirTool.execute({ path: ".", depth: 2 }, this.workspaceRoot);
    } catch {
      workspaceSummary = "(could not list workspace)";
    }

    const systemPrompt = [
      "You are an autonomous coding agent. Your workspace is at: " + this.workspaceRoot,
      "All file paths you use in tool calls must be relative to this workspace root.",
      "",
      "Workspace structure:",
      workspaceSummary,
      "",
      "Use the provided tools to read, search, write, and edit files to complete the task.",
      "Always read files before editing them to understand their current content.",
      "When you are done, respond with a concise summary of what you changed.",
    ].join("\n");

    const messages: LLMMessage[] = [
      Message.system(systemPrompt),
      Message.user(task),
    ];

    const toolCallLog: ToolCallRecord[] = [];
    let totalToolCalls = 0;
    let finalResponseText = "";

    try {
      while (true) {
        if (totalToolCalls >= maxToolCalls) {
          return {
            status: "FAIL",
            failureReason: `Agent exceeded max tool calls limit (${maxToolCalls}). Task may be too complex or stuck in a loop.`,
          };
        }

        const response = await this.client.complete({
          model,
          messages,
          tools: buildToolDefinitions(),
          toolChoice: "auto",
        });

        const assistantMsg = response.message;
        messages.push(assistantMsg);

        if (response.finishReason.reason === "stop") {
          finalResponseText = Message.getText(assistantMsg);
          break;
        }

        if (response.finishReason.reason !== "tool_calls") {
          // Unexpected finish reason — treat as done
          finalResponseText = Message.getText(assistantMsg);
          break;
        }

        // Execute each tool call in this turn
        const toolCalls = assistantMsg.content.filter((p) => p.kind === "tool_call" && p.toolCall);

        if (toolCalls.length === 0) {
          // No tool calls despite tool_calls finish reason — treat as done
          finalResponseText = Message.getText(assistantMsg);
          break;
        }

        for (const part of toolCalls) {
          const tc = part.toolCall!;
          totalToolCalls++;

          const rawArgs = typeof tc.arguments === "string"
            ? JSON.parse(tc.arguments)
            : tc.arguments;

          let result: string;
          let isError = false;

          const tool = findTool(tc.name);
          if (!tool) {
            result = `Unknown tool: ${tc.name}`;
            isError = true;
          } else {
            try {
              result = await tool.execute(rawArgs, this.workspaceRoot);
            } catch (err) {
              result = String(err);
              isError = true;
            }
          }

          const record: ToolCallRecord = {
            turn: totalToolCalls,
            toolCallId: tc.id,
            name: tc.name,
            args: rawArgs,
            result: result.slice(0, 2000), // truncate for log
            isError,
          };
          toolCallLog.push(record);

          // Emit LOG event so the UI shows live progress
          const argSummary = JSON.stringify(rawArgs).slice(0, 80);
          emit({
            type: "LOG",
            runId,
            timestamp: new Date().toISOString(),
            nodeId: node.id,
            message: `[${tc.name}] ${argSummary}${isError ? " → ERROR" : ""}`,
          });

          // Feed result back to LLM
          messages.push(Message.toolResult(tc.id, result, isError));
        }
      }
    } catch (err) {
      return { status: "FAIL", failureReason: String(err) };
    }

    // Write logs
    await fs.writeFile(join(stageDir, "response.md"), finalResponseText, "utf-8");
    if (toolCallLog.length > 0) {
      const jsonl = toolCallLog.map((r) => JSON.stringify(r)).join("\n");
      await fs.writeFile(join(stageDir, "tool_calls.jsonl"), jsonl, "utf-8");
    }

    const outcome: Outcome = {
      status: "SUCCESS",
      notes: `Agent completed: ${node.id} (${totalToolCalls} tool calls)`,
      contextUpdates: {
        last_stage: node.id,
        last_response: finalResponseText.slice(0, 200),
        agent_tool_calls: totalToolCalls,
      },
    };

    await fs.writeFile(
      join(stageDir, "status.json"),
      JSON.stringify(outcome, null, 2),
      "utf-8",
    );

    return outcome;
  }
}
