// edit_file — surgical exact-string replacement in an existing file

import { promises as fs } from "fs";
import type { AgentTool } from "./index.js";
import { safePath } from "./index.js";

export const editFileTool: AgentTool = {
  definition: {
    name: "edit_file",
    description:
      "Make a surgical edit to an existing file by replacing an exact string with a new string. The old_string must match exactly (including whitespace and indentation). Fails if old_string is not found or if it matches more than once — in that case, include more surrounding context in old_string to make it unique.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file, relative to the workspace root.",
        },
        old_string: {
          type: "string",
          description: "The exact string to find and replace. Must appear exactly once in the file.",
        },
        new_string: {
          type: "string",
          description: "The string to replace old_string with.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },

  async execute(args, workspaceRoot) {
    const { path, old_string, new_string } = args as {
      path: string;
      old_string: string;
      new_string: string;
    };

    const abs = safePath(workspaceRoot, path);
    const content = await fs.readFile(abs, "utf-8");

    const count = content.split(old_string).length - 1;
    if (count === 0) {
      throw new Error(
        `old_string not found in ${path}. Read the file first to verify the exact content.`
      );
    }
    if (count > 1) {
      throw new Error(
        `old_string found ${count} times in ${path}. Provide more surrounding context to make it unique.`
      );
    }

    const updated = content.replace(old_string, new_string);
    await fs.writeFile(abs, updated, "utf-8");
    return `Edited ${path}: replaced ${old_string.length} chars with ${new_string.length} chars`;
  },
};
