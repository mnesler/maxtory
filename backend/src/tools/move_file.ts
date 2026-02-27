// move_file — rename or move a file within the workspace

import { promises as fs } from "fs";
import { dirname } from "path";
import type { AgentTool } from "./index.js";
import { safePath } from "./index.js";

export const moveFileTool: AgentTool = {
  definition: {
    name: "move_file",
    description:
      "Rename or move a file within the workspace. Creates parent directories of the destination if they don't exist. Can also be used to rename a file in place.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Current path of the file, relative to workspace root.",
        },
        destination: {
          type: "string",
          description: "New path for the file, relative to workspace root.",
        },
      },
      required: ["source", "destination"],
    },
  },

  async execute(args, workspaceRoot) {
    const { source, destination } = args as { source: string; destination: string };
    const srcAbs = safePath(workspaceRoot, source);
    const dstAbs = safePath(workspaceRoot, destination);

    // Ensure destination parent directory exists
    await fs.mkdir(dirname(dstAbs), { recursive: true });
    await fs.rename(srcAbs, dstAbs);
    return `Moved ${source} → ${destination}`;
  },
};
