// Built-in tools shared across all provider profiles

import type { RegisteredTool, ExecutionEnvironment } from "./types.js";

// ─── Output truncation ─────────────────────────────────────────────────────────

export type TruncationMode = "head_tail" | "tail";

export function truncateOutput(output: string, maxChars: number, mode: TruncationMode): string {
  if (output.length <= maxChars) return output;

  if (mode === "head_tail") {
    const half = Math.floor(maxChars / 2);
    const removed = output.length - maxChars;
    return (
      output.slice(0, half) +
      `\n\n[WARNING: Tool output was truncated. ${removed} characters were removed from the middle. The full output is available in the event stream. If you need to see specific parts, re-run the tool with more targeted parameters.]\n\n` +
      output.slice(-half)
    );
  }

  // tail
  const removed = output.length - maxChars;
  return (
    `[WARNING: Tool output was truncated. First ${removed} characters were removed. The full output is available in the event stream.]\n\n` +
    output.slice(-maxChars)
  );
}

export function truncateLines(output: string, maxLines: number): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  const headCount = Math.floor(maxLines / 2);
  const tailCount = maxLines - headCount;
  const omitted = lines.length - headCount - tailCount;
  return (
    lines.slice(0, headCount).join("\n") +
    `\n[... ${omitted} lines omitted ...]\n` +
    lines.slice(-tailCount).join("\n")
  );
}

// ─── read_file ─────────────────────────────────────────────────────────────────

export const READ_FILE_TOOL: RegisteredTool = {
  definition: {
    name: "read_file",
    description: "Read a file from the filesystem. Returns line-numbered content.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute or relative path to the file" },
        offset: { type: "integer", description: "1-based line number to start reading from" },
        limit: { type: "integer", description: "Max lines to read (default 2000)" },
      },
      required: ["file_path"],
    },
  },
  executor: async (args, env: ExecutionEnvironment) => {
    const path = args.file_path as string;
    const offset = args.offset as number | undefined;
    const limit = args.limit as number | undefined;
    return env.readFile(path, offset, limit ?? 2000);
  },
};

// ─── write_file ────────────────────────────────────────────────────────────────

export const WRITE_FILE_TOOL: RegisteredTool = {
  definition: {
    name: "write_file",
    description: "Write content to a file. Creates the file and parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute or relative path" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["file_path", "content"],
    },
  },
  executor: async (args, env: ExecutionEnvironment) => {
    const path = args.file_path as string;
    const content = args.content as string;
    await env.writeFile(path, content);
    return `Written ${content.length} bytes to ${path}`;
  },
};

// ─── edit_file ─────────────────────────────────────────────────────────────────

export const EDIT_FILE_TOOL: RegisteredTool = {
  definition: {
    name: "edit_file",
    description: "Replace an exact string occurrence in a file.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        old_string: { type: "string", description: "Exact text to find and replace" },
        new_string: { type: "string", description: "Replacement text" },
        replace_all: { type: "boolean", description: "Replace all occurrences (default false)" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  executor: async (args, env: ExecutionEnvironment) => {
    const path = args.file_path as string;
    const oldStr = args.old_string as string;
    const newStr = args.new_string as string;
    const replaceAll = (args.replace_all as boolean) ?? false;

    const content = await env.readFile(path);
    // Strip line numbers added by readFile
    const raw = content.replace(/^ *\d+ \| /gm, "");

    if (!raw.includes(oldStr)) {
      throw new Error(`old_string not found in ${path}`);
    }

    let count = 0;
    let updated: string;
    if (replaceAll) {
      updated = raw.split(oldStr).join(newStr);
      count = (raw.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    } else {
      const idx = raw.indexOf(oldStr);
      const all = raw.split(oldStr).length - 1;
      if (all > 1) {
        throw new Error(
          `old_string matches ${all} locations in ${path}. Provide more context or use replace_all=true.`,
        );
      }
      updated = raw.slice(0, idx) + newStr + raw.slice(idx + oldStr.length);
      count = 1;
    }

    await env.writeFile(path, updated);
    return `Replaced ${count} occurrence(s) in ${path}`;
  },
};

// ─── shell ─────────────────────────────────────────────────────────────────────

export function makeShellTool(defaultTimeoutMs: number, maxTimeoutMs: number): RegisteredTool {
  return {
    definition: {
      name: "shell",
      description: "Execute a shell command. Returns stdout, stderr, and exit code.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to run" },
          timeout_ms: { type: "integer", description: "Override default timeout in ms" },
          description: { type: "string", description: "Human-readable description of what this does" },
        },
        required: ["command"],
      },
    },
    executor: async (args, env: ExecutionEnvironment) => {
      const command = args.command as string;
      const timeout = Math.min(
        (args.timeout_ms as number | undefined) ?? defaultTimeoutMs,
        maxTimeoutMs,
      );
      const result = await env.execCommand(command, timeout);
      const combined = [
        result.stdout,
        result.stderr ? `[stderr]\n${result.stderr}` : "",
        `[exit code: ${result.exitCode}, duration: ${result.durationMs}ms]`,
      ]
        .filter(Boolean)
        .join("\n");
      return combined;
    },
  };
}

// ─── grep ──────────────────────────────────────────────────────────────────────

export const GREP_TOOL: RegisteredTool = {
  definition: {
    name: "grep",
    description: "Search file contents using regex patterns.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory or file to search" },
        glob_filter: { type: "string", description: "File pattern filter (e.g. *.ts)" },
        case_insensitive: { type: "boolean" },
        max_results: { type: "integer", description: "Max matches to return (default 100)" },
      },
      required: ["pattern"],
    },
  },
  executor: async (args, env: ExecutionEnvironment) => {
    const pattern = args.pattern as string;
    const path = (args.path as string | undefined) ?? env.workingDirectory();
    return env.grep(pattern, path, {
      caseInsensitive: args.case_insensitive as boolean | undefined,
      globFilter: args.glob_filter as string | undefined,
      maxResults: (args.max_results as number | undefined) ?? 100,
    });
  },
};

// ─── glob ──────────────────────────────────────────────────────────────────────

export const GLOB_TOOL: RegisteredTool = {
  definition: {
    name: "glob",
    description: "Find files matching a glob pattern.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts)" },
        path: { type: "string", description: "Base directory (default: working dir)" },
      },
      required: ["pattern"],
    },
  },
  executor: async (args, env: ExecutionEnvironment) => {
    const pattern = args.pattern as string;
    const path = (args.path as string | undefined) ?? env.workingDirectory();
    const results = await env.glob(pattern, path);
    return results.join("\n") || "(no files found)";
  },
};
