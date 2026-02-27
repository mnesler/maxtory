// Tests for tools/index.ts — safePath, buildToolDefinitions, findTool

import { describe, it, expect } from "vitest";
import { safePath, buildToolDefinitions, findTool, ALL_TOOLS } from "./index.js";

describe("safePath", () => {
  const root = "/workspace";

  it("resolves a simple relative path", () => {
    expect(safePath(root, "src/file.ts")).toBe("/workspace/src/file.ts");
  });

  it("resolves a file at the root", () => {
    expect(safePath(root, "README.md")).toBe("/workspace/README.md");
  });

  it("resolves a path with dot segments that stay inside root", () => {
    expect(safePath(root, "src/../lib/file.ts")).toBe("/workspace/lib/file.ts");
  });

  it("throws on path traversal with ..", () => {
    expect(() => safePath(root, "../etc/passwd")).toThrow("Path traversal not allowed");
  });

  it("throws on deep path traversal", () => {
    expect(() => safePath(root, "src/../../etc/passwd")).toThrow("Path traversal not allowed");
  });
});

describe("buildToolDefinitions", () => {
  it("returns an array of ToolDefinitions", () => {
    const defs = buildToolDefinitions();
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBe(ALL_TOOLS.length);
  });

  it("every definition has a name and description", () => {
    for (const def of buildToolDefinitions()) {
      expect(typeof def.name).toBe("string");
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.description).toBe("string");
    }
  });

  it("tool names are unique", () => {
    const names = buildToolDefinitions().map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes expected tools", () => {
    const names = new Set(buildToolDefinitions().map((d) => d.name));
    for (const expected of [
      "read_file",
      "write_file",
      "edit_file",
      "list_dir",
      "glob_files",
      "search",
      "delete_file",
      "move_file",
    ]) {
      expect(names.has(expected), `Expected tool "${expected}" to be registered`).toBe(true);
    }
  });
});

describe("findTool", () => {
  it("finds a tool by name", () => {
    const tool = findTool("read_file");
    expect(tool).toBeDefined();
    expect(tool!.definition.name).toBe("read_file");
  });

  it("returns undefined for unknown tool", () => {
    expect(findTool("nonexistent_tool")).toBeUndefined();
  });
});
