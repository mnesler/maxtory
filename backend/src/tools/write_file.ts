// write_file — create or fully overwrite a file

import { promises as fs } from "fs";
import { dirname } from "path";
import type { AgentTool } from "./index.js";
import { safePath } from "./index.js";

export const writeFileTool: AgentTool = {
  definition: {
    name: "write_file",
    description:
      "Create a new file or completely overwrite an existing file with the given content. Creates parent directories if they don't exist. Use edit_file for surgical edits to existing files — only use write_file when creating new files or performing a full rewrite.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file, relative to the workspace root.",
        },
        content: {
          type: "string",
          description: "The full content to write to the file.",
        },
      },
      required: ["path", "content"],
    },
  },

  async execute(args, workspaceRoot) {
    const { path, content } = args as { path: string; content: string };
    const abs = safePath(workspaceRoot, path);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
    const bytes = Buffer.byteLength(content, "utf-8");
    return `Written ${bytes} bytes to ${path}`;
  },
};
