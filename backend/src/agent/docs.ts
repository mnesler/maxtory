// Project document discovery (AGENTS.md, CLAUDE.md, etc.)

import { promises as fs } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";

const MAX_PROJECT_DOCS_BYTES = 32 * 1024;

const AGENT_DOC_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".codex/instructions.md"];

function findGitRoot(cwd: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: "pipe" })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export async function discoverProjectDocs(
  workingDir: string,
  activeProvider: string,
): Promise<string> {
  const root = findGitRoot(workingDir) ?? workingDir;

  // Candidate directories: from root down to cwd
  const candidates: string[] = [root];
  let dir = workingDir;
  while (dir !== root && dir !== dirname(dir)) {
    candidates.push(dir);
    dir = dirname(dir);
  }

  const sections: string[] = [];
  let totalBytes = 0;

  for (const candidate of candidates) {
    for (const filename of AGENT_DOC_FILES) {
      // Skip provider-specific files that don't match current provider
      if (filename === "GEMINI.md" && activeProvider !== "gemini") continue;
      if (filename === ".codex/instructions.md" && activeProvider !== "openai") continue;

      const filepath = join(candidate, filename);
      try {
        const content = await fs.readFile(filepath, "utf-8");
        const trimmed = content.trim();
        if (!trimmed) continue;

        const bytes = Buffer.byteLength(trimmed);
        if (totalBytes + bytes > MAX_PROJECT_DOCS_BYTES) {
          sections.push(`[Project instructions truncated at ${MAX_PROJECT_DOCS_BYTES / 1024}KB]`);
          return sections.join("\n\n---\n\n");
        }

        sections.push(`<!-- ${filepath} -->\n${trimmed}`);
        totalBytes += bytes;
      } catch {
        // file not found, skip
      }
    }
  }

  return sections.join("\n\n---\n\n");
}
