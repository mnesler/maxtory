// Tests for write_file tool

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeFileTool } from "./write_file.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "maxtory-write-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("write_file tool", () => {
  it("creates a new file", async () => {
    await writeFileTool.execute({ path: "new.txt", content: "hello" }, dir);
    const data = await fs.readFile(join(dir, "new.txt"), "utf-8");
    expect(data).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    await fs.writeFile(join(dir, "existing.txt"), "old content");
    await writeFileTool.execute({ path: "existing.txt", content: "new content" }, dir);
    const data = await fs.readFile(join(dir, "existing.txt"), "utf-8");
    expect(data).toBe("new content");
  });

  it("creates parent directories if needed", async () => {
    await writeFileTool.execute({ path: "deep/nested/file.txt", content: "deep" }, dir);
    const data = await fs.readFile(join(dir, "deep/nested/file.txt"), "utf-8");
    expect(data).toBe("deep");
  });

  it("returns confirmation message", async () => {
    const result = await writeFileTool.execute({ path: "out.txt", content: "x" }, dir);
    expect(result).toContain("out.txt");
  });

  it("throws on path traversal", async () => {
    await expect(writeFileTool.execute({ path: "../escape.txt", content: "x" }, dir)).rejects.toThrow("Path traversal");
  });
});
