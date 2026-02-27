// list_dir — directory listing as an indented tree

import { promises as fs } from "fs";
import { join, relative } from "path";
import type { AgentTool } from "./index.js";
import { safePath } from "./index.js";

const DEFAULT_DEPTH = 3;
const MAX_ENTRIES = 200;

async function buildTree(
  dir: string,
  workspaceRoot: string,
  depth: number,
  maxDepth: number,
  entries: string[],
): Promise<void> {
  if (depth > maxDepth || entries.length >= MAX_ENTRIES) return;

  let items: import("fs").Dirent[];
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort: directories first, then files, both alphabetically
  items.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of items) {
    if (entries.length >= MAX_ENTRIES) break;
    // Skip common noise directories
    if (item.isDirectory() && ["node_modules", ".git", "dist", ".vite"].includes(item.name)) {
      continue;
    }
    const indent = "  ".repeat(depth);
    const rel = relative(workspaceRoot, join(dir, item.name));
    entries.push(`${indent}${item.isDirectory() ? `${item.name}/` : item.name}  (${rel})`);
    if (item.isDirectory()) {
      await buildTree(join(dir, item.name), workspaceRoot, depth + 1, maxDepth, entries);
    }
  }
}

export const listDirTool: AgentTool = {
  definition: {
    name: "list_dir",
    description:
      "List files and directories in the workspace as an indented tree. Skips node_modules, .git, dist, and .vite. Use this to understand the project structure before reading or editing files.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to the workspace root. Defaults to '.' (workspace root).",
        },
        depth: {
          type: "number",
          description: `Maximum depth to traverse. Defaults to ${DEFAULT_DEPTH}.`,
        },
      },
      required: [],
    },
  },

  async execute(args, workspaceRoot) {
    const { path = ".", depth = DEFAULT_DEPTH } = args as {
      path?: string;
      depth?: number;
    };

    const abs = safePath(workspaceRoot, path);
    const entries: string[] = [`${path === "." ? "(workspace root)" : path}/`];
    await buildTree(abs, workspaceRoot, 1, depth, entries);

    if (entries.length >= MAX_ENTRIES) {
      entries.push(`... (truncated at ${MAX_ENTRIES} entries)`);
    }

    return entries.join("\n");
  },
};
