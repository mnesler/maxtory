// LocalExecutionEnvironment — runs tools on the local machine

import { promises as fs } from "fs";
import { spawn } from "child_process";
import { join, resolve, relative } from "path";
import { execSync } from "child_process";
import type { ExecutionEnvironment, ExecResult, DirEntry, GrepOptions } from "./types.js";

const SENSITIVE_ENV_PATTERNS = [
  /_api_key$/i,
  /_secret$/i,
  /_token$/i,
  /_password$/i,
  /_credential$/i,
  /_pass$/i,
];

const SAFE_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "SHELL", "LANG", "TERM", "TMPDIR",
  "GOPATH", "GOROOT", "CARGO_HOME", "NVM_DIR", "PYENV_ROOT",
  "JAVA_HOME", "ANDROID_HOME", "NODE_PATH",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
]);

function buildSafeEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue;
    if (SAFE_ENV_KEYS.has(k)) {
      safe[k] = v;
      continue;
    }
    if (SENSITIVE_ENV_PATTERNS.some((p) => p.test(k))) continue;
    safe[k] = v;
  }
  return safe;
}

export class LocalExecutionEnvironment implements ExecutionEnvironment {
  constructor(private cwd: string = process.cwd()) {}

  workingDirectory(): string {
    return this.cwd;
  }

  platform(): string {
    return process.platform === "win32" ? "windows" : process.platform;
  }

  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}

  private resolvePath(p: string): string {
    if (!p.startsWith("/")) return resolve(this.cwd, p);
    return p;
  }

  async readFile(path: string, offset?: number, limit?: number): Promise<string> {
    const abs = this.resolvePath(path);
    const raw = await fs.readFile(abs, "utf-8");
    const lines = raw.split("\n");
    const start = offset != null ? offset - 1 : 0;
    const end = limit != null ? start + limit : lines.length;
    return lines
      .slice(start, end)
      .map((line, i) => `${String(start + i + 1).padStart(4)} | ${line}`)
      .join("\n");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const abs = this.resolvePath(path);
    await fs.mkdir(abs.substring(0, abs.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(path));
      return true;
    } catch {
      return false;
    }
  }

  async listDirectory(path: string, depth = 1): Promise<DirEntry[]> {
    const abs = this.resolvePath(path);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const result: DirEntry[] = [];
    for (const e of entries) {
      result.push({ name: e.name, isDir: e.isDirectory() });
    }
    return result;
  }

  async execCommand(
    command: string,
    timeoutMs: number,
    workingDir?: string,
    envVars?: Record<string, string>,
  ): Promise<ExecResult> {
    const cwd = workingDir ? this.resolvePath(workingDir) : this.cwd;
    const env = { ...buildSafeEnv(), ...(envVars ?? {}) };
    const start = Date.now();

    return new Promise((resolve) => {
      const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
      const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];
      const child = spawn(shell, shellArgs, {
        cwd,
        env,
        detached: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid!, "SIGTERM"); } catch {}
        setTimeout(() => {
          try { process.kill(-child.pid!, "SIGKILL"); } catch {}
        }, 2000);
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        let finalStdout = stdout;
        if (timedOut) {
          finalStdout += `\n[ERROR: Command timed out after ${timeoutMs}ms. Partial output is shown above.\nYou can retry with a longer timeout by setting the timeout_ms parameter.]`;
        }
        resolve({
          stdout: finalStdout,
          stderr,
          exitCode: code ?? -1,
          timedOut,
          durationMs,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          stdout: "",
          stderr: String(err),
          exitCode: -1,
          timedOut: false,
          durationMs: Date.now() - start,
        });
      });
    });
  }

  async grep(pattern: string, path: string, options: GrepOptions = {}): Promise<string> {
    const abs = this.resolvePath(path);
    const flags = [
      "-rn",
      options.caseInsensitive ? "-i" : "",
      `--max-count=${options.maxResults ?? 100}`,
      options.globFilter ? `--include='${options.globFilter}'` : "",
      "--",
      pattern,
      abs,
    ]
      .filter(Boolean)
      .join(" ");

    const result = await this.execCommand(`grep ${flags}`, 10_000);
    return result.stdout || result.stderr;
  }

  async glob(pattern: string, basePath: string): Promise<string[]> {
    const abs = this.resolvePath(basePath);
    const result = await this.execCommand(
      `find ${abs} -type f -name '${pattern.split("/").pop() ?? pattern}' | sort`,
      10_000,
    );
    return result.stdout.trim().split("\n").filter(Boolean);
  }
}
