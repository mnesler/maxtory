// Tool registry — AgentTool interface + all built-in tools

import type { ToolDefinition } from "../llm/client.js";
import { resolve, relative, isAbsolute } from "path";

// ── AgentTool interface ───────────────────────────────────────────────────────

export interface AgentTool {
  definition: ToolDefinition;
  execute(args: unknown, workspaceRoot: string): Promise<string>;
}

// ── Path safety ───────────────────────────────────────────────────────────────

/**
 * Resolve a user-supplied path relative to workspaceRoot and verify it doesn't
 * escape the root via path traversal. Throws if the resolved path is outside.
 */
export function safePath(workspaceRoot: string, userPath: string): string {
  const abs = resolve(workspaceRoot, userPath);
  const rel = relative(workspaceRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path traversal not allowed: ${userPath}`);
  }
  return abs;
}

// ── Registry (imported after safePath to avoid circular deps) ─────────────────

import { readFileTool } from "./read_file.js";
import { writeFileTool } from "./write_file.js";
import { editFileTool } from "./edit_file.js";
import { listDirTool } from "./list_dir.js";
import { globFilesTool } from "./glob_files.js";
import { searchTool } from "./search.js";
import { deleteFileTool } from "./delete_file.js";
import { moveFileTool } from "./move_file.js";

export const ALL_TOOLS: AgentTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  globFilesTool,
  searchTool,
  deleteFileTool,
  moveFileTool,
];

/** Returns the ToolDefinition[] array to pass to client.complete() */
export function buildToolDefinitions(): ToolDefinition[] {
  return ALL_TOOLS.map((t) => t.definition);
}

/** Find a tool by name for execution */
export function findTool(name: string): AgentTool | undefined {
  return ALL_TOOLS.find((t) => t.definition.name === name);
}
