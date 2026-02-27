// search — grep/regex search across files

import { promises as fs } from "fs";
import { join, relative } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { AgentTool } from "./index.js";
import { safePath } from "./index.js";

const execAsync = promisify(exec);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vite", "coverage"]);
const MAX_MATCHES = 200;

async function searchWithRg(
  pattern: string,
  dir: string,
  include?: string,
): Promise<string> {
  const includeFlag = include ? `--glob '${include}'` : "";
  const cmd = `rg --line-number --no-heading --color=never ${includeFlag} -- ${JSON.stringify(pattern)} ${JSON.stringify(dir)}`;
  const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 512 });
  return stdout.trim();
}

async function searchWithNode(
  pattern: string,
  dir: string,
  workspaceRoot: string,
  include?: string,
  matches: string[] = [],
): Promise<void> {
  if (matches.length >= MAX_MATCHES) return;

  let items: import("fs").Dirent[];
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const regex = new RegExp(pattern, "m");
  const includeRegex = include
    ? new RegExp(
        "^" +
          include
            .replace(/[.+^${}()|[\]\\]/g, (c) => `\\${c}`)
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".") +
          "$",
      )
    : null;

  for (const item of items) {
    if (matches.length >= MAX_MATCHES) break;
    if (item.isDirectory()) {
      if (SKIP_DIRS.has(item.name)) continue;
      await searchWithNode(pattern, join(dir, item.name), workspaceRoot, include, matches);
    } else {
      const rel = relative(workspaceRoot, join(dir, item.name));
      if (includeRegex && !includeRegex.test(item.name)) continue;
      try {
        const content = await fs.readFile(join(dir, item.name), "utf-8");
        const lines = content.split("\n");
        const lineRegex = new RegExp(pattern);
        lines.forEach((line, idx) => {
          if (matches.length < MAX_MATCHES && lineRegex.test(line)) {
            matches.push(`${rel}:${idx + 1}:${line}`);
          }
        });
      } catch {
        // skip binary or unreadable files
      }
    }
  }
}

export const searchTool: AgentTool = {
  definition: {
    name: "search",
    description:
      "Search for a regex pattern across files in the workspace. Returns matching lines in the format 'file:line:content'. Use include to filter by filename pattern (e.g. '*.ts').",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression pattern to search for.",
        },
        path: {
          type: "string",
          description: "Directory to search in, relative to workspace root. Defaults to '.'.",
        },
        include: {
          type: "string",
          description: "Filename glob filter, e.g. '*.ts' or '*.{ts,tsx}'.",
        },
      },
      required: ["pattern"],
    },
  },

  async execute(args, workspaceRoot) {
    const { pattern, path = ".", include } = args as {
      pattern: string;
      path?: string;
      include?: string;
    };

    const abs = safePath(workspaceRoot, path);

    // Try rg first, fall back to Node.js implementation
    try {
      const result = await searchWithRg(pattern, abs, include);
      if (!result) return `No matches found for: ${pattern}`;
      const lines = result.split("\n");
      // Make paths relative to workspaceRoot
      const relLines = lines.map((l) => {
        const firstColon = l.indexOf(":");
        if (firstColon === -1) return l;
        const absFilePath = l.slice(0, firstColon);
        const rest = l.slice(firstColon);
        try {
          const rel = relative(workspaceRoot, absFilePath);
          return `${rel}${rest}`;
        } catch {
          return l;
        }
      });
      return relLines.slice(0, MAX_MATCHES).join("\n");
    } catch {
      // rg not available or failed — use Node.js fallback
      const matches: string[] = [];
      await searchWithNode(pattern, abs, workspaceRoot, include, matches);
      if (matches.length === 0) return `No matches found for: ${pattern}`;
      const truncated = matches.length >= MAX_MATCHES ? `\n(truncated at ${MAX_MATCHES} matches)` : "";
      return matches.join("\n") + truncated;
    }
  },
};
