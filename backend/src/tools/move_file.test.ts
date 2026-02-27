// Tests for move_file tool

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { moveFileTool } from "./move_file.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "maxtory-move-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("move_file tool", () => {
  it("renames a file", async () => {
    await fs.writeFile(join(dir, "old.txt"), "content");
    await moveFileTool.execute({ source: "old.txt", destination: "new.txt" }, dir);

    await expect(fs.access(join(dir, "old.txt"))).rejects.toThrow();
    const data = await fs.readFile(join(dir, "new.txt"), "utf-8");
    expect(data).toBe("content");
  });

  it("moves a file to a subdirectory, creating it if needed", async () => {
    await fs.writeFile(join(dir, "file.ts"), "ts");
    await moveFileTool.execute({ source: "file.ts", destination: "sub/deep/file.ts" }, dir);

    await expect(fs.access(join(dir, "file.ts"))).rejects.toThrow();
    const data = await fs.readFile(join(dir, "sub/deep/file.ts"), "utf-8");
    expect(data).toBe("ts");
  });

  it("returns confirmation message", async () => {
    await fs.writeFile(join(dir, "a.txt"), "");
    const result = await moveFileTool.execute({ source: "a.txt", destination: "b.txt" }, dir);
    expect(result).toContain("a.txt");
    expect(result).toContain("b.txt");
  });

  it("throws on path traversal for source", async () => {
    await expect(moveFileTool.execute({ source: "../bad.txt", destination: "ok.txt" }, dir)).rejects.toThrow("Path traversal");
  });

  it("throws on path traversal for destination", async () => {
    await fs.writeFile(join(dir, "ok.txt"), "");
    await expect(moveFileTool.execute({ source: "ok.txt", destination: "../escape.txt" }, dir)).rejects.toThrow("Path traversal");
  });
});
