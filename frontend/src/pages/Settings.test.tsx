// Tests for Settings page — workspace root card

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import Settings from "./Settings.js";
import { api } from "../api/client.js";

// Mock the api module
vi.mock("../api/client.js", () => ({
  api: {
    getSettings: vi.fn(),
    setModel: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

const mockSettings = {
  model: "moonshotai/kimi-k2",
  workspaceRoot: "/tmp/repo",
  models: [
    { id: "moonshotai/kimi-k2", name: "Kimi K2" },
  ],
};

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(mockSettings);
  vi.mocked(api.setModel).mockResolvedValue({ ...mockSettings, model: "new-model" });
  vi.mocked(api.updateSettings).mockResolvedValue({ ...mockSettings, workspaceRoot: "/new/path" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Settings page", () => {
  it("renders the Workspace Root card with current value", async () => {
    render(() => <Settings />);

    await waitFor(() => {
      expect(screen.getByText("Workspace Root")).toBeTruthy();
    });

    expect(screen.getByText("/tmp/repo")).toBeTruthy();
  });

  it("renders workspace root input and Apply button", async () => {
    render(() => <Settings />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("/path/to/workspace")).toBeTruthy();
    });
  });

  it("calls updateSettings with new workspace root on form submit", async () => {
    render(() => <Settings />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("/path/to/workspace")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("/path/to/workspace") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "/new/workspace" } });

    // Find Apply button inside the workspace form (last Apply button on the page)
    const applyButtons = screen.getAllByText("Apply");
    // The workspace apply button is the last one
    fireEvent.click(applyButtons[applyButtons.length - 1]);

    await waitFor(() => {
      expect(api.updateSettings).toHaveBeenCalledWith({ workspaceRoot: "/new/workspace" });
    });
  });

  it("shows saved confirmation after successful workspace update", async () => {
    render(() => <Settings />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("/path/to/workspace")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("/path/to/workspace") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "/new/workspace" } });

    const applyButtons = screen.getAllByText("Apply");
    fireEvent.click(applyButtons[applyButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText("Workspace root updated.")).toBeTruthy();
    });
  });
});
