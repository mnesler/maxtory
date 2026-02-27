// JSON file persistence for pipeline runs

import { promises as fs } from "fs";
import { join, dirname } from "path";
import type { PipelineRun } from "../pipeline/types.js";

const STORE_PATH = process.env.ATTRACTOR_STORE_PATH ?? "./data/runs.json";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function loadRuns(): Promise<Map<string, PipelineRun>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const arr = JSON.parse(raw) as PipelineRun[];
    const map = new Map<string, PipelineRun>();
    for (const run of arr) {
      map.set(run.id, run);
    }
    console.log(`[store] Loaded ${map.size} run(s) from ${STORE_PATH}`);
    return map;
  } catch (err: unknown) {
    // File doesn't exist yet — start fresh
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    console.warn(`[store] Could not load runs: ${err}`);
    return new Map();
  }
}

// ─── Save ─────────────────────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRuns: Map<string, PipelineRun> | null = null;

/**
 * Debounced save — flushes at most once per 500 ms so rapid in-flight
 * updates (NODE_START, NODE_COMPLETE, etc.) don't hammer the disk.
 */
export function scheduleSave(runs: Map<string, PipelineRun>): void {
  pendingRuns = runs;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const snapshot = pendingRuns!;
    pendingRuns = null;
    flushSave(snapshot).catch((err) =>
      console.error(`[store] Save failed: ${err}`),
    );
  }, 500);
}

async function flushSave(runs: Map<string, PipelineRun>): Promise<void> {
  await ensureDir(STORE_PATH);
  const arr = Array.from(runs.values());
  // Write to a temp file then rename for atomicity
  const tmp = STORE_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(arr, null, 2), "utf-8");
  await fs.rename(tmp, STORE_PATH);
}
