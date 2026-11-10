import { existsSync } from "node:fs";
import type { WorktreeReport, WorktreeVerdict } from "../shared/types.ts";
import { git, listWorktrees, type WorktreeEntry } from "./git.ts";
import type { PrRow } from "./github.ts";
import { mapLimit } from "./proc.ts";

export interface WorktreeFacts {
  dirty: number;
  unpushed: number; // commits on HEAD that no remote branch holds
  unpushedKnown: boolean;
  headInPr: boolean; // HEAD is the PR head, or an ancestor of it
  lastCommitAt: string | null;
}

export async function worktreeFacts(path: string, pr: PrRow | null): Promise<WorktreeFacts> {
  const [status, unpushed, log] = await Promise.all([
    git(path, ["status", "--porcelain", "--untracked-files=normal"], 30_000),
    git(path, ["rev-list", "--count", "HEAD", "--not", "--remotes"], 30_000),
    git(path, ["log", "-1", "--format=%cI"]),
  ]);
  let headInPr = false;
  if (pr?.headRefOid) {
    const head = await git(path, ["rev-parse", "HEAD"]);
    if (head.ok && head.stdout.trim() === pr.headRefOid) headInPr = true;
    else headInPr = (await git(path, ["merge-base", "--is-ancestor", "HEAD", pr.headRefOid])).ok;
  }
  return {
    dirty: status.ok ? status.stdout.split("\n").filter((l) => l.trim()).length : 0,
    unpushed: unpushed.ok ? Number(unpushed.stdout.trim()) || 0 : 0,
    unpushedKnown: status.ok && unpushed.ok,
    headInPr,
    lastCommitAt: log.ok ? log.stdout.trim() || null : null,
  };
}

/** The keep-or-delete advice for one worktree. Pure, so the rules are tested on their own. */
export function verdictFor(input: {
  isMain: boolean;
  exists: boolean;
  liveSessions: number;
  facts: WorktreeFacts | null;
  pr: { number: number; state: string } | null;
}): { verdict: WorktreeVerdict; reason: string } {
  const { isMain, exists, liveSessions, facts, pr } = input;
  if (isMain) return { verdict: "main", reason: "This is the main checkout. It is never deleted." };
  if (!exists) return { verdict: "gone", reason: "The folder is already gone. Safe to prune." };
  if (liveSessions > 0) {
    return { verdict: "in-use", reason: liveSessions === 1 ? "A live session works here." : `${liveSessions} live sessions work here.` };
  }
  if (!facts || !facts.unpushedKnown) return { verdict: "keep", reason: "Can't tell if all work is saved. Keep it." };
  if (facts.dirty > 0) {
    return { verdict: "keep", reason: `${facts.dirty} uncommitted change${facts.dirty === 1 ? "" : "s"} would be lost.` };
  }
  const covered = facts.unpushed === 0 || (pr !== null && pr.state !== "OPEN" && facts.headInPr);
  if (!covered) {
    return { verdict: "keep", reason: `${facts.unpushed} commit${facts.unpushed === 1 ? " is" : "s are"} not on GitHub yet.` };
  }
  if (pr?.state === "OPEN") {
    return { verdict: "keep", reason: `PR #${pr.number} is still open. You may need this folder for review fixes.` };
  }
  if (pr?.state === "MERGED") return { verdict: "safe", reason: `PR #${pr.number} was merged and nothing is unsaved.` };
  if (pr?.state === "CLOSED") return { verdict: "probably-safe", reason: `PR #${pr.number} was closed without merging. All work is on GitHub.` };
  return { verdict: "probably-safe", reason: "Nothing is unsaved and all commits are on GitHub, but no PR was found." };
}

export function insidePath(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

/** A session lives in a folder it started in, or one it went on to work in, as in `cd ../shield-27336`. */
export function worksIn(s: { cwd: string; git: { root: string } | null }, path: string): boolean {
  return insidePath(s.cwd, path) || (!!s.git && insidePath(s.git.root, path));
}

export async function buildReport(
  mainRoot: string,
  wt: WorktreeEntry,
  ctx: {
    prs: Map<string, PrRow>;
    livePids: (path: string) => number[];
    claim: (path: string) => { live: boolean; note: string } | null;
  },
): Promise<WorktreeReport> {
  const isMain = wt.path === mainRoot;
  const exists = !wt.prunable && existsSync(wt.path);
  const pr = wt.branch ? (ctx.prs.get(wt.branch) ?? null) : null;
  const liveSessions = ctx.livePids(wt.path);
  const facts = !isMain && exists ? await worktreeFacts(wt.path, pr) : null;
  const { verdict, reason } = verdictFor({
    isMain,
    exists,
    liveSessions: liveSessions.length,
    facts,
    pr: pr ? { number: pr.number, state: pr.state } : null,
  });
  return {
    path: wt.path,
    branch: wt.branch,
    verdict,
    reason,
    dirty: facts?.dirty ?? 0,
    unpushed: facts?.unpushed ?? 0,
    unpushedKnown: facts?.unpushedKnown ?? false,
    pr: pr ? { number: pr.number, state: pr.state, url: pr.url } : null,
    liveSessions,
    claim: ctx.claim(wt.path),
    lastCommitAt: facts?.lastCommitAt ?? null,
  };
}

/** One PR per branch: the open one, else the latest. */
export function prsByBranch(rows: PrRow[]): Map<string, PrRow> {
  const map = new Map<string, PrRow>();
  for (const r of rows) {
    const cur = map.get(r.headRefName);
    if (!cur || (r.state === "OPEN" && cur.state !== "OPEN") || (cur.state !== "OPEN" && r.updatedAt > cur.updatedAt)) {
      map.set(r.headRefName, r);
    }
  }
  return map;
}

export interface ScanJob {
  repo: string;
  running: boolean;
  done: number;
  total: number;
  reports: WorktreeReport[];
  startedAt: number;
  finishedAt: number | null;
}

export async function scanRepo(
  job: ScanJob,
  prs: PrRow[],
  livePids: (path: string) => number[],
  claim: (path: string) => { live: boolean; note: string } | null,
): Promise<void> {
  const entries = await listWorktrees(job.repo);
  job.total = entries.length;
  const byBranch = prsByBranch(prs);
  job.reports = await mapLimit(entries, 8, async (wt) => {
    const report = await buildReport(job.repo, wt, { prs: byBranch, livePids, claim });
    job.done++;
    return report;
  });
  job.running = false;
  job.finishedAt = Date.now();
}
