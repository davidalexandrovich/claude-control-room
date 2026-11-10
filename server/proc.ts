import { execFile, spawn } from "node:child_process";

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

// The app may start from Finder with a bare PATH, so Homebrew and ~/.local/bin are added.
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", `${process.env.HOME}/.local/bin`];
export const CHILD_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: [...EXTRA_PATH, process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin"].join(":"),
};

/** Pure: the folders of `first`, then those of `rest` it lacks, as one PATH. */
export function mergePath(first: string, rest: string): string {
  return [...new Set([...first.split(":"), ...rest.split(":")].filter(Boolean))].join(":");
}

const PATH_MARK = "__control_room_path__";

/** The PATH your login shell sets up. nvm, asdf, Volta and the like add to it in ~/.zshrc, which Finder never runs. */
export async function loginShellPath(shell = process.env.SHELL || "/bin/zsh"): Promise<string | null> {
  // A mark, since ~/.zshrc may print its own lines; no stdin, so a prompt in it can't hold the shell open.
  const r = await run(shell, ["-lic", `printf '\\n${PATH_MARK}%s\\n' "$PATH"`], { timeoutMs: 10_000, input: "" });
  const line = r.stdout.split("\n").find((l) => l.startsWith(PATH_MARK));
  return line ? line.slice(PATH_MARK.length) || null : null;
}

/** Once at startup, so `claude` (an npm install under nvm, say) is found where your terminal finds it. */
export async function useLoginShellPath(): Promise<void> {
  const path = await loginShellPath();
  if (path) CHILD_ENV.PATH = mergePath(path, CHILD_ENV.PATH ?? "");
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; input?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 15_000,
        maxBuffer: 32 * 1024 * 1024,
        env: opts.env ?? CHILD_ENV,
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve({ ok: !error, code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}

/** Starts a program that outlives this request, e.g. `open` or a login flow. */
export function launch(cmd: string, args: string[], opts: { cwd?: string } = {}): void {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: CHILD_ENV, detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

export interface ProcRow {
  pid: number;
  ppid: number;
  cpu: number;
  comm: string;
}

export async function processTable(): Promise<Map<number, ProcRow>> {
  const out = await run("ps", ["-axo", "pid=,ppid=,pcpu=,comm="], { timeoutMs: 5_000 });
  const rows = new Map<number, ProcRow>();
  for (const line of out.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(line);
    if (!m) continue;
    rows.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]), comm: m[4].trim() });
  }
  return rows;
}

export function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

// macOS starts these at every login; the oldest one dates the login even if another restarts later.
const LOGIN_AGENTS = new Set(["Dock", "SystemUIServer", "ControlCenter", "Finder"]);

/** A ps "etime" value ("[[dd-]hh:]mm:ss") in seconds. */
export function etimeSeconds(etime: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 86_400 + Number(m[2] ?? 0) * 3_600 + Number(m[3]) * 60 + Number(m[4]);
}

/** Seconds since this Mac login began, from `ps -x -o etime=,comm=` output; null when no login agent is listed. */
export function loginAgeFrom(psOutput: string): number | null {
  let oldest: number | null = null;
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(\S+)\s+(.+)$/.exec(line);
    if (!m || !LOGIN_AGENTS.has(basename(m[2].trim()))) continue;
    const age = etimeSeconds(m[1]);
    if (age !== null && (oldest === null || age > oldest)) oldest = age;
  }
  return oldest;
}

export async function loginAgeSeconds(): Promise<number | null> {
  const out = await run("ps", ["-x", "-o", "etime=,comm="], { timeoutMs: 5_000, env: { ...CHILD_ENV, LC_ALL: "C" } });
  return out.ok ? loginAgeFrom(out.stdout) : null;
}

/** True when the command name is the Claude Code CLI binary. */
export function isClaudeComm(comm: string): boolean {
  return basename(comm) === "claude";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Runs `fn` over items with at most `limit` running at once. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
