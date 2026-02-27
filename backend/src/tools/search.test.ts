// Tests for search tool

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { searchTool } from "./search.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "maxtory-search-"));
  await fs.writeFile(join(dir, "a.ts"), 'const foo = "hello";\nconst bar = "world";\n');
  await fs.mkdir(join(dir, "sub"));
  await fs.writeFile(join(dir, "sub", "b.ts"), 'function greet() { return "hello"; }\n');
  await fs.writeFile(join(dir, "other.md"), "# hello world\n");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("search tool", () => {
  it("finds a pattern across files", async () => {
    const result = await searchTool.execute({ pattern: "hello" }, dir);
    expect(result).toContain("a.ts");
    expect(result).toContain("sub/b.ts");
    expect(result).toContain("other.md");
  });

  it("finds with include glob filter", async () => {
    const result = await searchTool.execute({ pattern: "hello", include: "**/*.ts" }, dir);
    expect(result).toContain("a.ts");
    expect(result).toContain("sub/b.ts");
    expect(result).not.toContain("other.md");
  });

  it("returns no match message when nothing found", async () => {
    const result = await searchTool.execute({ pattern: "XYZNOTFOUND123" }, dir);
    expect(result).toContain("No matches");
  });

  it("includes line numbers in results", async () => {
    const result = await searchTool.execute({ pattern: "greet" }, dir);
    expect(result).toMatch(/:\d+:/);
  });
});
