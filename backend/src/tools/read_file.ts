// read_file — read a file from the workspace with line numbers

import { promises as fs } from "fs";
import type { AgentTool } from "./index.js";
import { safePath } from "./index.js";

export const readFileTool: AgentTool = {
  definition: {
    name: "read_file",
    description:
      "Read the contents of a file. Returns the file contents with line numbers prefixed as 'N: content'. Use this to inspect source code, configs, or any text file before editing.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file, relative to the workspace root.",
        },
        start_line: {
          type: "number",
          description: "1-based line number to start reading from (optional, defaults to 1).",
        },
        end_line: {
          type: "number",
          description: "1-based line number to stop reading at, inclusive (optional, defaults to end of file).",
        },
      },
      required: ["path"],
    },
  },

  async execute(args, workspaceRoot) {
    const { path, start_line, end_line } = args as {
      path: string;
      start_line?: number;
      end_line?: number;
    };

    const abs = safePath(workspaceRoot, path);
    const content = await fs.readFile(abs, "utf-8");
    const lines = content.split("\n");

    const start = start_line != null ? Math.max(1, start_line) : 1;
    const end = end_line != null ? Math.min(lines.length, end_line) : lines.length;

    const slice = lines.slice(start - 1, end);
    return slice.map((line, i) => `${start + i}: ${line}`).join("\n");
  },
};
