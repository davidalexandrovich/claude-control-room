import { dirname, resolve } from "node:path";
import type { GitInfo } from "../shared/types.ts";
import { run } from "./proc.ts";

const cache = new Map<string, { at: number; value: GitInfo | null }>();
const remotes = new Map<string, GitInfo["remote"]>();

export function git(cwd: string, args: string[], timeoutMs = 10_000) {
  return run("git", ["-C", cwd, ...args], { timeoutMs });
}

export function parseRemote(url: string): GitInfo["remote"] {
  const m = /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?\s*$/.exec(url.trim());
  return m ? { owner: m[1], name: m[2] } : null;
}

export function parseShortstat(text: string): { insertions: number; deletions: number } {
  const ins = /(\d+) insertions?\(\+\)/.exec(text);
  const del = /(\d+) deletions?\(-\)/.exec(text);
  return { insertions: ins ? Number(ins[1]) : 0, deletions: del ? Number(del[1]) : 0 };
}

/** Git facts for a folder, cached for `maxAgeMs`. Returns null outside a repo. */
export async function gitInfo(cwd: string, maxAgeMs: number): Promise<GitInfo | null> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  const value = await readGit(cwd);
  cache.set(cwd, { at: Date.now(), value });
  return value;
}

/**
 * The checkout a session works in: the last of `folders` that is another worktree of its own folder's repo, else its
 * own folder's. One started in ~/code/shield that went on to `cd ../shield-27336` is on that worktree's branch. A
 * folder of another repo, or none, is a look elsewhere (an edit under ~/.claude, say), and a trip back to the main
 * checkout (`cd ~/code/shield && .venv/bin/pytest`) borrows its tools: neither is where it works.
 */
export async function workingGit(cwd: string, folders: string[], maxAgeMs: number): Promise<GitInfo | null> {
  const own = await gitInfo(cwd, maxAgeMs);
  for (const dir of [...folders].reverse()) {
    // Which checkout a folder is in seldom changes, so the folders passed over are read once a minute at most.
    const there = await gitInfo(dir, Math.max(maxAgeMs, 60_000));
    if (!there) continue;
    if (!own || (there.mainRoot === own.mainRoot && there.root !== own.mainRoot && there.root !== own.root)) return gitInfo(dir, maxAgeMs);
  }
  return own;
}

async function readGit(cwd: string): Promise<GitInfo | null> {
  const top = await git(cwd, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"]);
  if (!top.ok) return null;
  const [root, commonDir] = top.stdout.trim().split("\n");
  if (!root || !commonDir) return null;
  const mainRoot = commonDir.endsWith("/.git") ? dirname(commonDir) : resolve(commonDir, "..");

  const [status, stat] = await Promise.all([
    git(cwd, ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]),
    git(cwd, ["diff", "--shortstat", "HEAD"]),
  ]);
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let dirty = 0;
  for (const line of status.stdout.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const head = line.slice(14).trim();
      branch = head === "(detached)" ? null : head;
    } else if (line.startsWith("# branch.upstream ")) upstream = line.slice(18).trim();
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line && !line.startsWith("#")) dirty++;
  }
  if (!upstream && branch) {
    // No upstream yet: count the commits this branch adds on top of main.
    const count = await git(cwd, ["rev-list", "--count", "origin/main..HEAD"]);
    if (count.ok) ahead = Number(count.stdout.trim()) || 0;
  }
  if (!remotes.has(mainRoot)) {
    const url = await git(cwd, ["remote", "get-url", "origin"]);
    remotes.set(mainRoot, url.ok ? parseRemote(url.stdout) : null);
  }
  const { insertions, deletions } = parseShortstat(stat.stdout);
  return {
    root,
    mainRoot,
    isWorktree: root !== mainRoot,
    branch,
    dirty,
    insertions,
    deletions,
    ahead,
    behind,
    upstream,
    remote: remotes.get(mainRoot) ?? null,
  };
}

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  head: string | null;
  prunable: boolean;
}

export async function listWorktrees(mainRoot: string): Promise<WorktreeEntry[]> {
  const out = await git(mainRoot, ["worktree", "list", "--porcelain"], 20_000);
  const entries: WorktreeEntry[] = [];
  let cur: WorktreeEntry | null = null;
  for (const line of out.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) entries.push(cur);
      cur = { path: line.slice(9), branch: null, head: null, prunable: false };
    } else if (cur && line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (cur && line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (cur && line.startsWith("prunable")) cur.prunable = true;
  }
  if (cur) entries.push(cur);
  return entries;
}
