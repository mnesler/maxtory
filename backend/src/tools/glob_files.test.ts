// Tests for glob_files tool

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { globFilesTool } from "./glob_files.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "maxtory-glob-"));
  await fs.mkdir(join(dir, "src"));
  await fs.mkdir(join(dir, "src", "components"));
  await fs.writeFile(join(dir, "src", "index.ts"), "");
  await fs.writeFile(join(dir, "src", "utils.ts"), "");
  await fs.writeFile(join(dir, "src", "components", "Button.tsx"), "");
  await fs.writeFile(join(dir, "README.md"), "");
  await fs.writeFile(join(dir, "package.json"), "");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("glob_files tool", () => {
  it("matches **/*.ts", async () => {
    const result = await globFilesTool.execute({ pattern: "**/*.ts" }, dir);
    expect(result).toContain("src/index.ts");
    expect(result).toContain("src/utils.ts");
    expect(result).not.toContain(".tsx");
    expect(result).not.toContain(".md");
  });

  it("matches *.md at root", async () => {
    const result = await globFilesTool.execute({ pattern: "*.md" }, dir);
    expect(result).toContain("README.md");
    expect(result).not.toContain(".ts");
  });

  it("matches {ts,tsx} union", async () => {
    const result = await globFilesTool.execute({ pattern: "**/*.{ts,tsx}" }, dir);
    expect(result).toContain("src/index.ts");
    expect(result).toContain("src/components/Button.tsx");
  });

  it("returns no match message when nothing matches", async () => {
    const result = await globFilesTool.execute({ pattern: "**/*.py" }, dir);
    expect(result).toContain("No files matched");
  });

  it("respects max_results", async () => {
    const result = await globFilesTool.execute({ pattern: "**/*.ts", max_results: 1 }, dir);
    const lines = result.trim().split("\n").filter((l) => !l.startsWith("("));
    expect(lines.length).toBe(1);
    expect(result).toContain("truncated at 1");
  });
});
