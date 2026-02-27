// delete_file — permanently delete a file from the workspace

import { promises as fs } from "fs";
import type { AgentTool } from "./index.js";
import { safePath } from "./index.js";

export const deleteFileTool: AgentTool = {
  definition: {
    name: "delete_file",
    description:
      "Permanently delete a file from the workspace. This cannot be undone. Only deletes files, not directories.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to delete, relative to the workspace root.",
        },
      },
      required: ["path"],
    },
  },

  async execute(args, workspaceRoot) {
    const { path } = args as { path: string };
    const abs = safePath(workspaceRoot, path);

    const stat = await fs.stat(abs);
    if (stat.isDirectory()) {
      throw new Error(`${path} is a directory. Only files can be deleted with this tool.`);
    }

    await fs.unlink(abs);
    return `Deleted ${path}`;
  },
};
