// Tests for read_file tool

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readFileTool } from "./read_file.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "maxtory-read-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("read_file tool", () => {
  it("reads a file", async () => {
    await fs.writeFile(join(dir, "hello.txt"), "line1\nline2\nline3\n");
    const result = await readFileTool.execute({ path: "hello.txt" }, dir);
    expect(result).toContain("1: line1");
    expect(result).toContain("2: line2");
    expect(result).toContain("3: line3");
  });

  it("respects start_line and end_line", async () => {
    await fs.writeFile(join(dir, "file.txt"), "a\nb\nc\nd\ne\n");
    const result = await readFileTool.execute({ path: "file.txt", start_line: 2, end_line: 4 }, dir);
    expect(result).toContain("2: b");
    expect(result).toContain("3: c");
    expect(result).toContain("4: d");
    expect(result).not.toContain("1: a");
    expect(result).not.toContain("5: e");
  });

  it("throws on missing file", async () => {
    await expect(readFileTool.execute({ path: "missing.txt" }, dir)).rejects.toThrow();
  });

  it("throws on path traversal", async () => {
    await expect(readFileTool.execute({ path: "../etc/passwd" }, dir)).rejects.toThrow("Path traversal");
  });
});
