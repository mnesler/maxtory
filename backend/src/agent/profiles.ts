// Provider Profiles — Anthropic-aligned (Claude Code-style)

import { execSync } from "child_process";
import type { ProviderProfile, ExecutionEnvironment, ToolDefinition } from "./types.js";
import { ToolRegistry } from "./types.js";
import {
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  GREP_TOOL,
  GLOB_TOOL,
  makeShellTool,
} from "./tools.js";

// ─── Shared environment context builder ────────────────────────────────────────

function buildEnvironmentBlock(env: ExecutionEnvironment): string {
  const cwd = env.workingDirectory();
  let gitBranch = "(not a git repo)";
  let isGit = false;

  try {
    gitBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, stdio: "pipe" })
      .toString()
      .trim();
    isGit = true;
  } catch {}

  return `<environment>
Working directory: ${cwd}
Is git repository: ${isGit}
Git branch: ${gitBranch}
Platform: ${env.platform()}
Today's date: ${new Date().toISOString().split("T")[0]}
</environment>`;
}

// ─── Anthropic Profile ─────────────────────────────────────────────────────────

const ANTHROPIC_BASE_PROMPT = `You are Claude Code, an AI coding assistant made by Anthropic.

You help users with software engineering tasks: writing code, fixing bugs, refactoring, explaining code, and more.

## Key principles

- **Read before editing.** Always read the relevant file sections before making changes.
- **Prefer editing over writing.** Edit existing files instead of creating new ones unless a new file is truly needed.
- **Use edit_file correctly.** The old_string must uniquely identify the exact location. Provide enough surrounding context to make it unambiguous. Never include line numbers.
- **Think before acting.** Understand the codebase structure before making changes.
- **Be conservative.** Make the smallest change that solves the problem.
- **Verify your work.** After changes, check that the modification is correct.

## Tool usage

Use tools to gather information and make changes. Do not guess at file contents — read them first.
When using edit_file, ensure old_string is an exact match of the content in the file.
`;

export class AnthropicProfile implements ProviderProfile {
  id = "anthropic";
  model: string;
  toolRegistry: ToolRegistry;
  supportsReasoning = true;
  supportsStreaming = true;
  supportsParallelToolCalls = true;
  contextWindowSize = 200_000;

  constructor(model = "claude-opus-4-5", config?: { defaultCommandTimeoutMs?: number; maxCommandTimeoutMs?: number }) {
    this.model = model;
    this.toolRegistry = new ToolRegistry();
    const shellTimeout = config?.defaultCommandTimeoutMs ?? 120_000;
    const maxTimeout = config?.maxCommandTimeoutMs ?? 600_000;

    this.toolRegistry.register(READ_FILE_TOOL);
    this.toolRegistry.register(WRITE_FILE_TOOL);
    this.toolRegistry.register(EDIT_FILE_TOOL);
    this.toolRegistry.register(makeShellTool(shellTimeout, maxTimeout));
    this.toolRegistry.register(GREP_TOOL);
    this.toolRegistry.register(GLOB_TOOL);
  }

  buildSystemPrompt(env: ExecutionEnvironment, projectDocs: string): string {
    return [
      ANTHROPIC_BASE_PROMPT,
      buildEnvironmentBlock(env),
      projectDocs ? `## Project instructions\n\n${projectDocs}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  tools(): ToolDefinition[] {
    return this.toolRegistry.definitions();
  }

  providerOptions(): Record<string, unknown> | undefined {
    return undefined;
  }
}

// ─── OpenAI Profile ────────────────────────────────────────────────────────────

const OPENAI_BASE_PROMPT = `You are a coding assistant powered by OpenAI. You help users with software engineering tasks.

## Key principles

- Use apply_patch for all file modifications. It is the preferred format.
- Use read_file to understand code before changing it.
- Keep changes minimal and focused.
- Verify changes by reading files after edits.

## apply_patch format

\`\`\`
*** <file_path>
--- <file_path>
@@
 <context line>
-<removed line>
+<added line>
 <context line>
\`\`\`
`;

export const APPLY_PATCH_TOOL = {
  definition: {
    name: "apply_patch",
    description: "Apply code changes using the v4a patch format. Supports creating, deleting, and modifying files.",
    parameters: {
      type: "object",
      properties: {
        patch: { type: "string", description: "The patch content in v4a format" },
      },
      required: ["patch"],
    },
  },
  executor: async (args: Record<string, unknown>, env: ExecutionEnvironment) => {
    const patch = args.patch as string;
    // Parse simple unified-ish diff format
    const lines = patch.split("\n");
    let currentFile: string | null = null;
    let origContent = "";
    let newContent = "";
    const affected: string[] = [];

    for (const line of lines) {
      if (line.startsWith("*** ")) {
        if (currentFile && origContent !== newContent) {
          await env.writeFile(currentFile, newContent);
          affected.push(currentFile);
        }
        currentFile = line.slice(4).trim();
        try {
          const raw = await env.readFile(currentFile);
          origContent = raw.replace(/^ *\d+ \| /gm, "");
        } catch {
          origContent = "";
        }
        newContent = origContent;
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        newContent += line.slice(1) + "\n";
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        newContent = newContent.replace(line.slice(1) + "\n", "");
      }
    }

    if (currentFile && origContent !== newContent) {
      await env.writeFile(currentFile, newContent);
      affected.push(currentFile);
    }

    return `Applied patch. Affected files: ${affected.join(", ") || "(none)"}`;
  },
};

export class OpenAIProfile implements ProviderProfile {
  id = "openai";
  model: string;
  toolRegistry: ToolRegistry;
  supportsReasoning = true;
  supportsStreaming = true;
  supportsParallelToolCalls = true;
  contextWindowSize = 128_000;

  constructor(model = "gpt-4o", config?: { defaultCommandTimeoutMs?: number; maxCommandTimeoutMs?: number }) {
    this.model = model;
    this.toolRegistry = new ToolRegistry();
    const shellTimeout = config?.defaultCommandTimeoutMs ?? 10_000;
    const maxTimeout = config?.maxCommandTimeoutMs ?? 600_000;

    this.toolRegistry.register(READ_FILE_TOOL);
    this.toolRegistry.register(WRITE_FILE_TOOL);
    this.toolRegistry.register(APPLY_PATCH_TOOL as typeof APPLY_PATCH_TOOL);
    this.toolRegistry.register(makeShellTool(shellTimeout, maxTimeout));
    this.toolRegistry.register(GREP_TOOL);
    this.toolRegistry.register(GLOB_TOOL);
  }

  buildSystemPrompt(env: ExecutionEnvironment, projectDocs: string): string {
    return [
      OPENAI_BASE_PROMPT,
      buildEnvironmentBlock(env),
      projectDocs ? `## Project instructions\n\n${projectDocs}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  tools(): ToolDefinition[] {
    return this.toolRegistry.definitions();
  }

  providerOptions(): Record<string, unknown> | undefined {
    return undefined;
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function createProfileForModel(
  model: string,
  config?: { defaultCommandTimeoutMs?: number; maxCommandTimeoutMs?: number },
): ProviderProfile {
  if (model.startsWith("claude")) return new AnthropicProfile(model, config);
  return new OpenAIProfile(model, config);
}
