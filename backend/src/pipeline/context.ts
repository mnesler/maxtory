// Pipeline Context implementation

import type { PipelineContext } from "./types.js";

export class Context implements PipelineContext {
  values: Map<string, unknown>;
  logs: string[];

  constructor(initial?: Record<string, unknown>) {
    this.values = new Map(Object.entries(initial ?? {}));
    this.logs = [];
  }

  get(key: string, defaultValue?: unknown): unknown {
    return this.values.has(key) ? this.values.get(key) : defaultValue;
  }

  getString(key: string, defaultValue = ""): string {
    const v = this.values.get(key);
    if (v == null) return defaultValue;
    return String(v);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  applyUpdates(updates: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(updates)) {
      this.values.set(k, v);
    }
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of this.values) result[k] = v;
    return result;
  }

  clone(): Context {
    const c = new Context(this.snapshot());
    c.logs = [...this.logs];
    return c;
  }

  appendLog(entry: string): void {
    this.logs.push(entry);
  }
}
