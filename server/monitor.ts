import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatLine, Session, Snapshot, Summary } from "../shared/types.ts";
import { currentAccount } from "./account.ts";
import { deriveActivity, type StatusFile } from "./activity.ts";
import { claimsOf, repoClaims } from "./claims.ts";
import { publicSettings, settings } from "./config.ts";
import { gitInfo } from "./git.ts";
import { ghReady, prByNumber, prForBranch, refreshRepo } from "./github.ts";
import { CLAUDE_PROJECTS_DIR, CLAUDE_SESSIONS_DIR, SUMMARIZER_CWD } from "./paths.ts";
import { powerState } from "./power.ts";
import { basename, isClaudeComm, processTable, type ProcRow } from "./proc.ts";
import { bridgeIdOf, remoteUrl } from "./remote.ts";
import { findStoryId, shortcutReady, story as storyFor } from "./shortcut.ts";
import { defaultEffort, latestUsage, readPermission, readTap, statusLineState } from "./statusline.ts";
import { maybeSummarize, storedSummary } from "./summaries.ts";
import { pickName, tabName } from "./names.ts";
import { modelName, readTranscript, type TranscriptState } from "./transcript.ts";
import { bridgeConnected, helperState, terminalName, windowFor } from "./vscode.ts";

export interface SessionFile extends StatusFile {
  pid: number;
  sessionId: string;
  cwd: string;
  kind: string;
  entrypoint: string;
  name: string | null;
  nameSource: string | null;
  tmux: string | null;
  bridgeSessionId: string | null; // set while Remote Control is on
}

export async function readSessionFiles(): Promise<SessionFile[]> {
  let names: string[];
  try {
    names = (await readdir(CLAUDE_SESSIONS_DIR)).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return [];
  }
  const files = await Promise.all(
    names.map(async (n) => {
      try {
        const d = JSON.parse(await readFile(join(CLAUDE_SESSIONS_DIR, n), "utf8"));
        const file: SessionFile = {
          pid: Number(d.pid),
          sessionId: String(d.sessionId ?? ""),
          cwd: String(d.cwd ?? ""),
          startedAt: Number(d.startedAt ?? 0),
          kind: String(d.kind ?? ""),
          entrypoint: String(d.entrypoint ?? ""),
          name: d.name ?? null,
          nameSource: d.nameSource ?? null,
          status: d.status ?? null,
          waitingFor: d.waitingFor ?? null,
          updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : null,
          statusUpdatedAt: typeof d.statusUpdatedAt === "number" ? d.statusUpdatedAt : null,
          tmux: typeof d.tmux === "string" ? d.tmux : null,
          bridgeSessionId: bridgeIdOf(d.bridgeSessionId),
        };
        return file;
      } catch {
        return null;
      }
    }),
  );
  return files.filter((f): f is SessionFile => f !== null && f.pid > 0 && !!f.sessionId);
}

function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

const transcriptPaths = new Map<string, { path: string | null; at: number }>();

async function findTranscript(sessionId: string, cwd: string): Promise<string | null> {
  const hit = transcriptPaths.get(sessionId);
  if (hit?.path && existsSync(hit.path)) return hit.path;
  if (hit && !hit.path && Date.now() - hit.at < 20_000) return null;
  let found: string | null = null;
  const direct = join(CLAUDE_PROJECTS_DIR, encodeProjectDir(cwd), `${sessionId}.jsonl`);
  if (existsSync(direct)) found = direct;
  else {
    try {
      for (const dir of await readdir(CLAUDE_PROJECTS_DIR)) {
        const p = join(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`);
        if (existsSync(p)) {
          found = p;
          break;
        }
      }
    } catch {
      /* no projects dir */
    }
  }
  transcriptPaths.set(sessionId, { path: found, at: Date.now() });
  return found;
}

function hostOf(pid: number, procs: Map<number, ProcRow>): Session["where"] {
  let cur = procs.get(pid);
  for (let i = 0; i < 8 && cur; i++) {
    const comm = cur.comm;
    if (/Code Helper|Visual Studio Code|Cursor Helper/.test(comm)) return "vscode";
    if (/tmux/.test(basename(comm))) return "tmux";
    if (/Terminal\.app|iTerm|Ghostty|WezTerm|kitty|Warp/i.test(comm)) return "terminal";
    cur = procs.get(cur.ppid);
  }
  return "other";
}

function fallbackSummary(input: { story: string | null; note: string | null; title: string | null; firstPrompt: string | null }): Summary {
  const firstSentence = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    const m = /^(.{20,160}?[.!?])(\s|$)/.exec(t);
    return m ? m[1] : t.length > 160 ? `${t.slice(0, 159)}…` : t;
  };
  if (input.story) return { headline: input.story, now: null, source: "story", updatedAt: null };
  if (input.note) return { headline: firstSentence(input.note), now: null, source: "claim", updatedAt: null };
  if (input.title) return { headline: input.title, now: null, source: "title", updatedAt: null };
  if (input.firstPrompt) return { headline: firstSentence(input.firstPrompt), now: null, source: "prompt", updatedAt: null };
  return { headline: "No task description yet", now: null, source: "none", updatedAt: null };
}

const PREVIEW_LINES = 8;

export class Monitor {
  snapshot: Snapshot | null = null;
  private listeners = new Set<(s: Snapshot) => void>();
  private lastJson = "";
  private prevStatus = new Map<string, string>();
  private transcripts = new Map<number, TranscriptState>();
  private effortDefault: string | null = null;
  private effortReadAt = 0;
  private ticking = false;
  procs = new Map<number, ProcRow>();
  files = new Map<number, SessionFile>();

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  transcriptOf(pid: number): TranscriptState | null {
    return this.transcripts.get(pid) ?? null;
  }

  isLiveClaude = (pid: number): boolean => {
    const p = this.procs.get(pid);
    return !!p && isClaudeComm(p.comm);
  };

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.collect();
    } finally {
      this.ticking = false;
    }
  }

  private async collect(): Promise<void> {
    const cfg = settings();
    const [files, procs] = await Promise.all([readSessionFiles(), processTable()]);
    this.procs = procs;
    if (Date.now() - this.effortReadAt > 60_000) {
      this.effortDefault = await defaultEffort();
      this.effortReadAt = Date.now();
    }
    const live = files.filter((f) => {
      const p = procs.get(f.pid);
      if (!p || !isClaudeComm(p.comm) || f.kind !== "interactive") return false;
      if (f.cwd.startsWith(SUMMARIZER_CWD)) return false;
      return f.entrypoint === "cli" || (cfg.includeIdePanel && f.entrypoint === "claude-vscode");
    });
    this.files = new Map(live.map((f) => [f.pid, f]));
    for (const pid of [...this.transcripts.keys()]) if (!this.files.has(pid)) this.transcripts.delete(pid);

    const sessions = await Promise.all(live.map((f) => this.buildSession(f, procs).catch(() => null)));
    const list = sessions.filter((s): s is Session => s !== null).sort((a, b) => b.startedAt - a.startedAt);

    const [usage, connection] = await Promise.all([latestUsage(), statusLineState()]);
    const windows = bridgeConnected();
    const snapshot: Snapshot = {
      at: Date.now(),
      sessions: list,
      usage,
      account: currentAccount(),
      power: powerState(),
      setup: {
        statusLine: connection.statusLine,
        hooks: connection.hooks,
        vscodeHelper: helperState(),
        vscodeWindows: windows,
        ghReady: ghReady(),
        shortcutReady: shortcutReady(),
      },
      settings: publicSettings(),
    };
    this.snapshot = snapshot;
    const json = JSON.stringify({ ...snapshot, at: 0 });
    if (json !== this.lastJson) {
      this.lastJson = json;
      for (const fn of this.listeners) fn(snapshot);
    }
  }

  private async buildSession(f: SessionFile, procs: Map<number, ProcRow>): Promise<Session> {
    const cfg = settings();
    const proc = procs.get(f.pid);
    const tap = await readTap(f.sessionId);
    const path = (tap?.transcriptPath && existsSync(tap.transcriptPath) ? tap.transcriptPath : null) ?? (await findTranscript(f.sessionId, f.cwd));
    const t = path ? await readTranscript(path) : null;
    if (t) this.transcripts.set(f.pid, t);
    const cwd = tap?.cwd ?? t?.cwd ?? f.cwd;
    const git = await gitInfo(cwd, f.status === "busy" ? 4_000 : 15_000);
    const shellPid = proc?.ppid ?? 0;
    const tab = tabName(terminalName(shellPid));

    let pr = null;
    if (git?.remote) {
      const slug = `${git.remote.owner}/${git.remote.name}`;
      refreshRepo(slug, 60_000);
      const isMain = !git.branch || git.branch === "main" || git.branch === "master";
      pr = (isMain ? null : prForBranch(slug, git.branch)) ?? (tap?.pr ? prByNumber(slug, tap.pr.number) : null);
      if (!pr && t?.prLink && t.prLink.repo.toLowerCase() === slug.toLowerCase()) pr = prByNumber(slug, t.prLink.number);
    }

    const reg = git ? await repoClaims(git.mainRoot, this.isLiveClaude) : null;
    const claims = claimsOf(reg, f.pid, f.sessionId);
    const userChat = t ? t.chat.filter((c) => c.role === "user").map((c) => c.text).join("\n") : null;
    const storyId = findStoryId([
      git?.branch,
      ...claims.map((c) => c.note),
      tab,
      t?.agentName,
      t?.aiTitle,
      t?.firstPrompt,
      t?.lastPrompt,
      userChat,
    ]);
    const story = storyFor(storyId);

    const now = Date.now();
    const ask = f.status === "waiting" ? await readPermission(f.sessionId) : null;
    const activity = deriveActivity(f, t, now, cfg.inactiveAfterMinutes * 60_000, ask);
    const title = t?.agentName ?? tap?.sessionName ?? t?.aiTitle ?? null;
    const branch = git?.branch && !["main", "master"].includes(git.branch) ? git.branch : null;

    const fallback = fallbackSummary({ story: story?.name ?? null, note: claims[0]?.note ?? null, title, firstPrompt: t?.firstPrompt ?? null });
    const ai = cfg.aiSummaries ? await storedSummary(f.sessionId) : null;
    const summary = ai ?? fallback;
    const [name, nameSource] = pickName({
      tab,
      custom: t?.agentName ?? null,
      title,
      story: story?.name ?? null,
      headline: ai?.headline ?? null,
      branch,
      folder: basename(cwd),
    });

    const prev = this.prevStatus.get(f.sessionId);
    this.prevStatus.set(f.sessionId, activity.kind);
    if (cfg.aiSummaries && t && activity.kind !== "inactive") {
      const recent = t.chat.slice(-14).map((c) => ({ role: c.role, text: c.text }));
      void maybeSummarize(
        {
          sessionId: f.sessionId,
          basisAt: t.lastEntryAt ?? 0,
          status: `${activity.label}${activity.detail ? ` — ${activity.detail}` : ""}`,
          title,
          story: story?.name ?? null,
          note: claims[0]?.note ?? null,
          firstPrompt: t.firstPrompt,
          recent,
        },
        { turnJustEnded: prev === "working" && activity.kind !== "working", working: activity.kind === "working" },
      );
    } else if (cfg.aiSummaries && t && !ai) {
      // An inactive session still gets one summary so its card says what it was about.
      void maybeSummarize(
        {
          sessionId: f.sessionId,
          basisAt: t.lastEntryAt ?? 0,
          status: "Inactive",
          title,
          story: story?.name ?? null,
          note: claims[0]?.note ?? null,
          firstPrompt: t.firstPrompt,
          recent: t.chat.slice(-10).map((c) => ({ role: c.role, text: c.text })),
        },
        { turnJustEnded: false, working: false },
      );
    }

    const chat: ChatLine[] = t ? t.chat.slice(-PREVIEW_LINES) : [];
    const effort = tap?.effort ?? ask?.effort ?? t?.effort ?? this.effortDefault;
    return {
      pid: f.pid,
      shellPid,
      sessionId: f.sessionId,
      name,
      nameSource,
      shortName: f.name ?? basename(cwd),
      cwd,
      startedAt: f.startedAt,
      lastActivityAt: Math.max(t?.lastEntryAt ?? 0, f.statusUpdatedAt ?? 0, f.updatedAt ?? 0) || f.startedAt,
      activity,
      summary,
      firstPrompt: t?.firstPrompt ?? null,
      chat,
      git,
      pr,
      story,
      storyId,
      claims,
      model: tap?.model ?? modelName(t?.model ?? null),
      effort,
      effortIsDefault: !tap?.effort && !ask?.effort && !t?.effort,
      contextPercent: tap?.contextPercent ?? null,
      costUsd: tap?.costUsd ?? t?.costUsd ?? null,
      repoName: git ? basename(git.mainRoot) : basename(cwd),
      where: f.tmux ? "tmux" : hostOf(f.pid, procs),
      vscodeLinked: windowFor(shellPid) !== null,
      transcriptPath: path,
      tmux: f.tmux,
      remoteUrl: remoteUrl(f.bridgeSessionId),
    };
  }
}
