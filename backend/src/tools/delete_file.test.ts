// Tests for delete_file tool

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { deleteFileTool } from "./delete_file.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "maxtory-delete-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("delete_file tool", () => {
  it("deletes an existing file", async () => {
    const filePath = join(dir, "delete-me.txt");
    await fs.writeFile(filePath, "bye");
    await deleteFileTool.execute({ path: "delete-me.txt" }, dir);
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it("returns confirmation message", async () => {
    await fs.writeFile(join(dir, "x.txt"), "");
    const result = await deleteFileTool.execute({ path: "x.txt" }, dir);
    expect(result).toContain("x.txt");
  });

  it("throws on missing file", async () => {
    await expect(deleteFileTool.execute({ path: "nonexistent.txt" }, dir)).rejects.toThrow();
  });

  it("throws when target is a directory", async () => {
    await fs.mkdir(join(dir, "subdir"));
    await expect(deleteFileTool.execute({ path: "subdir" }, dir)).rejects.toThrow();
  });

  it("throws on path traversal", async () => {
    await expect(deleteFileTool.execute({ path: "../important.txt" }, dir)).rejects.toThrow("Path traversal");
  });
});
