// Tests for list_dir tool

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { listDirTool } from "./list_dir.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "maxtory-list-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("list_dir tool", () => {
  it("lists files and directories", async () => {
    await fs.writeFile(join(dir, "a.txt"), "");
    await fs.writeFile(join(dir, "b.ts"), "");
    await fs.mkdir(join(dir, "sub"));
    await fs.writeFile(join(dir, "sub", "c.ts"), "");

    const result = await listDirTool.execute({ path: "." }, dir);
    expect(result).toContain("a.txt");
    expect(result).toContain("b.ts");
    expect(result).toContain("sub");
  });

  it("skips node_modules and .git", async () => {
    await fs.mkdir(join(dir, "node_modules"));
    await fs.writeFile(join(dir, "node_modules", "pkg.js"), "");
    await fs.mkdir(join(dir, ".git"));
    await fs.mkdir(join(dir, "src"));
    await fs.writeFile(join(dir, "src", "index.ts"), "");

    const result = await listDirTool.execute({ path: "." }, dir);
    expect(result).not.toContain("node_modules");
    expect(result).not.toContain(".git");
    expect(result).toContain("src");
  });

  it("lists a subdirectory", async () => {
    await fs.mkdir(join(dir, "sub"));
    await fs.writeFile(join(dir, "sub", "x.ts"), "");

    const result = await listDirTool.execute({ path: "sub" }, dir);
    expect(result).toContain("x.ts");
  });

  it("throws on path traversal", async () => {
    await expect(listDirTool.execute({ path: "../.." }, dir)).rejects.toThrow("Path traversal");
  });
});
