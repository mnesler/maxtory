// Tests for edit_file tool

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { editFileTool } from "./edit_file.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "maxtory-edit-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("edit_file tool", () => {
  it("replaces a unique string in a file", async () => {
    await fs.writeFile(join(dir, "code.ts"), 'const x = "hello";\nconst y = "world";\n');
    await editFileTool.execute(
      { path: "code.ts", old_string: '"hello"', new_string: '"goodbye"' },
      dir,
    );
    const result = await fs.readFile(join(dir, "code.ts"), "utf-8");
    expect(result).toContain('"goodbye"');
    expect(result).not.toContain('"hello"');
  });

  it("throws when old_string is not found", async () => {
    await fs.writeFile(join(dir, "code.ts"), "const x = 1;\n");
    await expect(
      editFileTool.execute({ path: "code.ts", old_string: "NOT_PRESENT", new_string: "x" }, dir),
    ).rejects.toThrow("not found");
  });

  it("throws when old_string matches multiple times", async () => {
    await fs.writeFile(join(dir, "dup.ts"), "foo\nfoo\nfoo\n");
    await expect(
      editFileTool.execute({ path: "dup.ts", old_string: "foo", new_string: "bar" }, dir),
    ).rejects.toThrow("found 3 times");
  });

  it("returns confirmation message", async () => {
    await fs.writeFile(join(dir, "f.txt"), "AAA BBB");
    const result = await editFileTool.execute({ path: "f.txt", old_string: "AAA", new_string: "ZZZ" }, dir);
    expect(result).toContain("f.txt");
  });

  it("throws on path traversal", async () => {
    await expect(
      editFileTool.execute({ path: "../bad.ts", old_string: "x", new_string: "y" }, dir),
    ).rejects.toThrow("Path traversal");
  });
});
