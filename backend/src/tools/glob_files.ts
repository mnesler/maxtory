// glob_files — find files matching a glob pattern

import { promises as fs } from "fs";
import { join, relative } from "path";
import type { AgentTool } from "./index.js";
import { safePath } from "./index.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vite", "coverage"]);

function matchGlob(pattern: string, filePath: string): boolean {
  // Convert glob pattern to regex in a single left-to-right pass
  // to avoid re-processing already-inserted regex syntax.
  let regexStr = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // ** glob
        if (pattern[i + 2] === "/") {
          // **/ → match zero or more path segments
          regexStr += "(.*/)?";
          i += 3;
        } else {
          // ** at end → match anything
          regexStr += ".*";
          i += 2;
        }
      } else {
        // single * → match any chars except /
        regexStr += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else if (ch === "{") {
      // Brace expansion {a,b,c}
      const end = pattern.indexOf("}", i);
      if (end === -1) {
        regexStr += "\\{";
        i++;
      } else {
        const group = pattern.slice(i + 1, end);
        regexStr += `(${group.split(",").map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("|")})`;
        i = end + 1;
      }
    } else if (".+^${}()|[\\".includes(ch)) {
      regexStr += `\\${ch}`;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(filePath);
}

async function walkDir(
  dir: string,
  workspaceRoot: string,
  pattern: string,
  results: string[],
  maxResults: number,
): Promise<void> {
  if (results.length >= maxResults) return;

  let items: import("fs").Dirent[];
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of items) {
    if (results.length >= maxResults) break;
    if (item.isDirectory()) {
      if (SKIP_DIRS.has(item.name)) continue;
      await walkDir(join(dir, item.name), workspaceRoot, pattern, results, maxResults);
    } else {
      const rel = relative(workspaceRoot, join(dir, item.name));
      if (matchGlob(pattern, rel)) {
        results.push(rel);
      }
    }
  }
}

export const globFilesTool: AgentTool = {
  definition: {
    name: "glob_files",
    description:
      "Find files matching a glob pattern in the workspace. Supports * (any chars except /), ** (any path), ?, and {a,b} alternatives. Examples: '**/*.ts', 'src/**/*.tsx', '*.json'.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match files against, e.g. '**/*.ts' or 'src/**/*.tsx'.",
        },
        path: {
          type: "string",
          description: "Directory to search in, relative to workspace root. Defaults to '.'.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 100.",
        },
      },
      required: ["pattern"],
    },
  },

  async execute(args, workspaceRoot) {
    const { pattern, path = ".", max_results = 100 } = args as {
      pattern: string;
      path?: string;
      max_results?: number;
    };

    const abs = safePath(workspaceRoot, path);
    const results: string[] = [];
    await walkDir(abs, workspaceRoot, pattern, results, max_results);

    if (results.length === 0) return `No files matched pattern: ${pattern}`;
    const output = results.sort().join("\n");
    const truncated = results.length >= max_results ? `\n(truncated at ${max_results} results)` : "";
    return output + truncated;
  },
};
