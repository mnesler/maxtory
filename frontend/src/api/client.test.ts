// Tests for the API client

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.js";

// Utility to create a mock fetch response
function mockResponse(body: unknown, ok = true, status = 200) {
  const isString = typeof body === "string";
  return {
    ok,
    status,
    json: async () => (isString ? body : body),
    text: async () => (isString ? body : JSON.stringify(body)),
  } as Response;
}

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("api.getSettings", () => {
  it("fetches settings from /api/settings", async () => {
    const settings = { model: "test-model", workspaceRoot: "/tmp", models: [] };
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(settings));

    const result = await api.getSettings();
    expect(result).toEqual(settings);
    expect(global.fetch).toHaveBeenCalledWith("/api/settings");
  });

  it("throws on non-OK response", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse({}, false, 500));
    await expect(api.getSettings()).rejects.toThrow("HTTP 500");
  });
});

describe("api.setModel", () => {
  it("PATCHes /api/settings with { model }", async () => {
    const settings = { model: "new-model", workspaceRoot: "/tmp", models: [] };
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(settings));

    const result = await api.setModel("new-model");
    expect(result.model).toBe("new-model");

    const [url, opts] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/settings");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ model: "new-model" });
  });
});

describe("api.updateSettings", () => {
  it("PATCHes /api/settings with arbitrary patch", async () => {
    const settings = { model: "m", workspaceRoot: "/new/path", models: [] };
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(settings));

    const result = await api.updateSettings({ workspaceRoot: "/new/path" });
    expect(result.workspaceRoot).toBe("/new/path");

    const [url, opts] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/settings");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ workspaceRoot: "/new/path" });
  });

  it("can patch both model and workspaceRoot at once", async () => {
    const settings = { model: "m2", workspaceRoot: "/ws2", models: [] };
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(settings));

    await api.updateSettings({ model: "m2", workspaceRoot: "/ws2" });

    const [, opts] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ model: "m2", workspaceRoot: "/ws2" });
  });
});

describe("api.getLogFile", () => {
  it("fetches the log file as text", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse("log content"));

    const result = await api.getLogFile("run-1", "node1", "response.md");
    expect(result).toBe("log content");
    expect(global.fetch).toHaveBeenCalledWith("/api/runs/run-1/logs/node1/response.md");
  });
});

describe("api.listRuns", () => {
  it("returns an array of runs", async () => {
    const runs = [{ id: "r1", status: "COMPLETED" }];
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(runs));

    const result = await api.listRuns();
    expect(result).toEqual(runs);
  });
});
