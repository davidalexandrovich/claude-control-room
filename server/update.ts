// Updating from the dashboard: pull the git checkout this app was built from, build it again, and let the app swap
// the new build in. The same steps as by hand: git pull, npm install when the packages changed, npm run package.
import { existsSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionResult, UpdateState } from "../shared/types.ts";
import { sessionEnv } from "./hosted.ts";
import { APP_DIR } from "./paths.ts";
import { run } from "./proc.ts";

const LOG = join(APP_DIR, "update.log");
const BUILD_MS = 15 * 60_000;

interface BuildInfo {
  source: string | null;
  commit: string | null;
  builtAt: string | null;
}

/** Written next to the server bundle by scripts/build-info.mjs; missing when the server runs from source. */
function readBuildInfo(): BuildInfo | null {
  try {
    const d = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "build-info.json"), "utf8")) as BuildInfo;
    return typeof d.source === "string" && existsSync(join(d.source, ".git")) ? d : null;
  } catch {
    return null;
  }
}

const info = readBuildInfo();
let install: ((builtApp: string) => void) | null = null;
let state: UpdateState = {
  source: info?.source ?? null,
  built: info?.commit ?? null,
  builtAt: info?.builtAt ?? null,
  branch: null,
  upstream: null,
  behind: 0,
  unbuilt: 0,
  incoming: [],
  dirty: false,
  checkedAt: null,
  phase: "idle",
  message: null,
  restarts: false,
};

export function updateState(): UpdateState {
  return state;
}

/** How the app swaps a new build in and restarts; without one, the build is left for you to start. */
export function onUpdateBuilt(fn: (builtApp: string) => void): void {
  install = fn;
  state = { ...state, restarts: true };
}

const running = () => state.phase !== "idle" && state.phase !== "failed";

function git(...args: string[]) {
  return run("git", ["-C", state.source!, ...args], { timeoutMs: 60_000 });
}

/** Looks for new commits on the branch's upstream. Offline, it says what it knew last. */
export async function checkForUpdate(): Promise<UpdateState> {
  if (!state.source || running()) return state;
  return refresh();
}

async function refresh(): Promise<UpdateState> {
  await git("fetch", "--quiet");
  const [branch, upstream, dirty] = await Promise.all([
    git("rev-parse", "--abbrev-ref", "HEAD"),
    git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"),
    git("status", "--porcelain", "--untracked-files=no"),
  ]);
  const up = upstream.ok ? upstream.stdout.trim() : null;
  const count = async (range: string) => {
    const r = await git("rev-list", "--count", range);
    return r.ok ? Number(r.stdout.trim()) || 0 : 0;
  };
  const behind = up ? await count("HEAD..@{u}") : 0;
  // A merge that brings in only what this build has already (how a pull request usually ends) leaves nothing to build.
  const same = state.built ? (await git("diff", "--quiet", state.built, "HEAD")).ok : false;
  const unbuilt = state.built && !same ? await count(`${state.built}..HEAD`) : 0;
  const log = await git("log", "--format=%s", "-8", behind ? "HEAD..@{u}" : `${state.built ?? "HEAD"}..HEAD`);
  state = {
    ...state,
    branch: branch.ok ? branch.stdout.trim() : null,
    upstream: up,
    behind,
    unbuilt,
    incoming: log.ok ? log.stdout.split("\n").filter(Boolean) : [],
    dirty: dirty.ok && dirty.stdout.trim() !== "",
    checkedAt: Date.now(),
  };
  return state;
}

/** Runs a command the way a terminal tab would: your login shell finds node and npm, nvm included. */
async function shell(command: string): Promise<{ ok: boolean; tail: string }> {
  const r = await run(process.env.SHELL || "/bin/zsh", ["-lic", command], { cwd: state.source!, env: sessionEnv(), timeoutMs: BUILD_MS });
  await appendFile(LOG, `\n$ ${command}\n${r.stdout}${r.stderr}`).catch(() => {});
  const tail = `${r.stderr}\n${r.stdout}`.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  return { ok: r.ok, tail };
}

function fail(message: string): void {
  state = { ...state, phase: "failed", message: `${message} The log is in ~/.claude-control-room/update.log.` };
}

export function startUpdate(): ActionResult {
  if (!state.source) return { ok: false, message: "This copy of Control Room was not built from a git checkout, so it can't update itself." };
  if (running()) return { ok: false, message: "It is updating already." };
  state = { ...state, phase: "pulling", message: null };
  void update().catch((err: Error) => fail(`The update stopped: ${err.message}.`));
  return { ok: true, message: "Updating. Control Room restarts when the new build is ready." };
}

async function update(): Promise<void> {
  await appendFile(LOG, `\n=== update ${new Date().toISOString()} in ${state.source}\n`).catch(() => {});
  await refresh();
  const before = (await git("rev-parse", "HEAD")).stdout.trim();
  if (state.behind > 0) {
    state = { ...state, phase: "pulling" };
    // Fast-forward only: a branch that went its own way is yours to sort out, never merged here.
    const pulled = await git("pull", "--ff-only", "--quiet");
    if (!pulled.ok) return fail(`git pull stopped: ${pulled.stderr.trim().split("\n").pop()}. Update ${state.source} by hand.`);
  }
  const changed = (await git("diff", "--name-only", before, "HEAD")).stdout.split("\n");
  if (changed.includes("package.json") || changed.includes("package-lock.json") || !existsSync(join(state.source!, "node_modules"))) {
    state = { ...state, phase: "installing" };
    const r = await shell("npm install --no-audit --no-fund");
    if (!r.ok) return fail(`npm install failed: ${r.tail}`);
  }
  state = { ...state, phase: "building" };
  const r = await shell("npm run package");
  if (!r.ok) return fail(`The build failed: ${r.tail}`);
  const builtApp = join(state.source!, "release", process.arch === "arm64" ? "mac-arm64" : "mac", "Control Room.app");
  if (!existsSync(builtApp)) return fail(`The build finished, but ${builtApp} is missing.`);
  if (!install) {
    state = { ...state, phase: "idle", message: `Built ${builtApp}. Restart Control Room to use it.` };
    return;
  }
  state = { ...state, phase: "restarting", message: null };
  install(builtApp);
}
