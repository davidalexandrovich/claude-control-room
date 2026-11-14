import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IdeId } from "../shared/ides.ts";
import type { AccountRef, ChatLine, OtherAccount, Session, Snapshot, Summary } from "../shared/types.ts";
import { currentAccount } from "./account.ts";
import { type Home, homeDir, homes, projectsDir, sessionsDir } from "./homes.ts";
import { deriveActivity, type StatusFile } from "./activity.ts";
import { claimsOf, repoClaims } from "./claims.ts";
import { publicSettings, settings } from "./config.ts";
import { gitInfo, workingGit } from "./git.ts";
import { ghReady, openSince, prByNumber, prForBranch, refreshRepo } from "./github.ts";
import { type HostedPane, hostedName, hostedPanes, isAgentName, isTerminalName, screenLines, tmuxReady } from "./hosted.ts";
import { agentActivity, allAgents } from "../shared/agents.ts";
import { agentChoices } from "./agents.ts";
import { agentUsages } from "./agent-usage.ts";
import { ideOf, installedIdes, noteConnectedIdes } from "./ide.ts";
import { HOME, SUMMARIZER_CWD } from "./paths.ts";
import { powerState } from "./power.ts";
import { basename, isClaudeComm, processTable, sleep, type ProcRow } from "./proc.ts";
import { bridgeIdOf, remoteUrl } from "./remote.ts";
import { findStoryId, shortcutReady, story as storyFor } from "./shortcut.ts";
import { defaultEffort, latestUsages, readPermission, readTap, statusLineState } from "./statusline.ts";
import { maybeSummarize, storedSummary, ticketName } from "./summaries.ts";
import { sortKey, usedAt } from "./order.ts";
import { updateState } from "./update.ts";
import { pickName, savedName, tabName } from "./names.ts";
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
  account: AccountRef | null; // the account whose config folder holds the file; null for ~/.claude
}

/** The session files of every account. */
export async function readSessionFiles(list: Home[] = homes()): Promise<SessionFile[]> {
  return (await Promise.all(list.map(readHomeSessions))).flat();
}

async function readHomeSessions(home: Home): Promise<SessionFile[]> {
  const dir = sessionsDir(home.dir);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return [];
  }
  const files = await Promise.all(
    names.map(async (n) => {
      try {
        const d = JSON.parse(await readFile(join(dir, n), "utf8"));
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
          account: home.account,
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

/**
 * The conversation file, in the projects folder of the session's account. `fresh` skips the remembered "none yet": a
 * first message may have just written it.
 */
export async function findTranscript(sessionId: string, cwd: string, account: AccountRef | null, fresh = false): Promise<string | null> {
  const hit = transcriptPaths.get(sessionId);
  if (hit?.path && existsSync(hit.path)) return hit.path;
  if (hit && !hit.path && !fresh && Date.now() - hit.at < 20_000) return null;
  let found: string | null = null;
  const projects = projectsDir(homeDir(account));
  const direct = join(projects, encodeProjectDir(cwd), `${sessionId}.jsonl`);
  if (existsSync(direct)) found = direct;
  else {
    try {
      for (const dir of await readdir(projects)) {
        const p = join(projects, dir, `${sessionId}.jsonl`);
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

// A mode set from Control Room shows at once; the transcript only records a mode with the next message.
const setModes = new Map<string, { mode: string; at: number }>();

export function noteMode(sessionId: string, mode: string): void {
  setModes.set(sessionId, { mode, at: Date.now() });
}

function modeOf(sessionId: string, t: TranscriptState | null): string | null {
  const set = setModes.get(sessionId);
  if (set && set.at > (t?.modeAt ?? 0)) return set.mode;
  return t?.mode ?? null;
}

/** The IDE whose terminal runs the process; null when tmux, a terminal app or nothing known comes first. */
function hostIde(pid: number, procs: Map<number, ProcRow>): IdeId | null {
  let cur = procs.get(pid);
  for (let i = 0; i < 8 && cur; i++) {
    const comm = cur.comm;
    const ide = ideOf(comm);
    if (ide) return ide;
    if (/tmux/.test(basename(comm)) || /Terminal\.app|iTerm|Ghostty|WezTerm|kitty|Warp/i.test(comm)) return null;
    cur = procs.get(cur.ppid);
  }
  return null;
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
const SCREEN_LINES = 14; // of a terminal, for its tile

// A terminal at its prompt runs only the shell; anything else in front is a command you started.
const SHELLS = /^-?(zsh|bash|sh|fish|nu|login)$/;

export class Monitor {
  snapshot: Snapshot | null = null;
  private listeners = new Set<(s: Snapshot) => void>();
  private lastJson = "";
  private prevStatus = new Map<string, string>();
  private transcripts = new Map<number, TranscriptState>();
  private effortDefaults = new Map<string, string | null>(); // by config folder
  private effortReadAt = 0;
  private ticking = false;
  procs = new Map<number, ProcRow>();
  files = new Map<number, SessionFile>();
  private hosted: HostedPane[] = []; // tmux sessions on Control Room's own server
  private commands = new Map<string, { command: string | null; since: number }>(); // what each terminal runs, since when
  // What each agent's screen showed, when it last moved, since when it has been moving, and whether it has worked yet.
  private screens = new Map<string, { text: string; changedAt: number; movingSince: number; worked: boolean }>();

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

  /** A tick that starts after now, so an action's result is in the snapshot it returns with. */
  async fresh(): Promise<void> {
    while (this.ticking) await sleep(50);
    await this.tick();
  }

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
    // Asked every time: a terminal there has no session file to tell of it. When tmux can't answer, the last answer
    // stands, so a console stays open.
    this.hosted = (await hostedPanes()) ?? this.hosted;
    const all = homes();
    await noteConnectedIdes(procs, all.map((h) => h.dir));
    if (Date.now() - this.effortReadAt > 60_000) {
      this.effortDefaults = new Map(await Promise.all(all.map(async (h) => [h.dir, await defaultEffort(h.dir)] as const)));
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

    const terminals = this.hosted.filter((p) => isTerminalName(p.name));
    const agents = this.hosted.filter((p) => isAgentName(p.name));
    for (const name of [...this.commands.keys()]) if (!terminals.some((p) => p.name === name)) this.commands.delete(name);
    for (const name of [...this.screens.keys()]) if (!agents.some((p) => p.name === name)) this.screens.delete(name);
    const sessions = await Promise.all([
      ...live.map((f) => this.buildSession(f, procs).catch(() => null)),
      ...terminals.map((p) => this.buildTerminal(p).catch(() => null)),
      ...agents.map((p) => this.buildAgent(p).catch(() => null)),
    ]);
    // The one you used last comes first, or where you dropped it. Claude's own work does not count, so the order holds
    // still while sessions run.
    const list = sessions.filter((s): s is Session => s !== null).sort((a, b) => b.sortKey - a.sortKey || b.startedAt - a.startedAt);

    const [usages, connections] = await Promise.all([latestUsages(all), Promise.all(all.map((h) => statusLineState(h.dir)))]);
    const connection = connections[0];
    const otherAccounts: OtherAccount[] = all.slice(1).map((h, i) => ({
      ...currentAccount(h.dir),
      ...h.account!,
      usage: usages[i + 1],
      connected: connections[i + 1].statusLine === "installed" && connections[i + 1].hooks,
    }));
    const windows = bridgeConnected();
    const [agentList, agentUsage] = await Promise.all([agentChoices(), agentUsages()]);
    const snapshot: Snapshot = {
      at: Date.now(),
      sessions: list,
      usage: usages[0],
      agentUsage,
      account: currentAccount(),
      otherAccounts,
      power: powerState(),
      setup: {
        statusLine: connection.statusLine,
        hooks: connection.hooks,
        links: connection.links,
        vscodeHelper: helperState(),
        vscodeWindows: windows,
        ides: installedIdes(),
        tmuxReady: tmuxReady(),
        ghReady: ghReady(),
        shortcutReady: shortcutReady(),
        agents: agentList,
      },
      settings: publicSettings(),
      update: updateState(),
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
    const path = (tap?.transcriptPath && existsSync(tap.transcriptPath) ? tap.transcriptPath : null) ?? (await findTranscript(f.sessionId, f.cwd, f.account));
    const t = path ? await readTranscript(path) : null;
    if (t) this.transcripts.set(f.pid, t);
    const cwd = tap?.cwd ?? t?.cwd ?? f.cwd;
    const git = await workingGit(cwd, t?.recentFolders ?? [], f.status === "busy" ? 4_000 : 15_000);
    const shellPid = proc?.ppid ?? 0;
    const tab = tabName(terminalName(shellPid));
    const saved = await savedName(f.sessionId);

    let pr = null;
    if (git?.remote) {
      const slug = `${git.remote.owner}/${git.remote.name}`;
      refreshRepo(slug, 60_000);
      const isMain = !git.branch || git.branch === "main" || git.branch === "master";
      // Sessions in one checkout share its branch, so its PR goes only to the session that made, committed or pushed
      // that branch. A worktree has one session; its PR counts unless it was done before the session started.
      const branchPr = isMain ? null : (prForBranch(slug, git.branch) ?? (tap?.pr ? prByNumber(slug, tap.pr.number) : null));
      const worked = !!git.branch && !!t?.workedBranches.includes(git.branch);
      pr = worked ? branchPr : git.isWorktree ? openSince(branchPr, f.startedAt) : null;
      if (!pr && t?.prLink && t.prLink.repo.toLowerCase() === slug.toLowerCase()) pr = prByNumber(slug, t.prLink.number);
    }
    // Work it did in another folder, the latest first: that folder's branch has its PR.
    for (const dir of [...(t?.workedFolders ?? [])].reverse()) {
      if (pr) break;
      const there = await gitInfo(dir, 60_000);
      if (!there?.remote || !there.branch || there.branch === "main" || there.branch === "master") continue;
      const slug = `${there.remote.owner}/${there.remote.name}`;
      refreshRepo(slug, 60_000);
      pr = prForBranch(slug, there.branch);
    }

    const reg = git ? await repoClaims(git.mainRoot, this.isLiveClaude) : null;
    const claims = claimsOf(reg, f.pid, f.sessionId);
    const userChat = t ? t.chat.filter((c) => c.role === "user").map((c) => c.text).join("\n") : null;
    const storyId = findStoryId([
      git?.branch,
      ...claims.map((c) => c.note),
      tab,
      saved,
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
    // Only a story the session started on or is named after names it; one mentioned later in the chat may be a side note.
    const named = story && findStoryId([git?.branch, ...claims.map((c) => c.note), tab, saved, t?.agentName, t?.aiTitle, t?.firstPrompt]) === story.id;
    const ticket = named ? await ticketName(story, cfg.aiSummaries ? { account: f.account } : null) : null;
    const [name, nameSource] = pickName({
      tab,
      saved,
      custom: t?.agentName ?? null,
      title,
      story: ticket,
      headline: ai?.headline ?? null,
      branch,
      folder: basename(cwd),
      prompted: Boolean(t?.firstPrompt),
    });

    const prev = this.prevStatus.get(f.sessionId);
    this.prevStatus.set(f.sessionId, activity.kind);
    if (cfg.aiSummaries && t && activity.kind !== "inactive") {
      const recent = t.chat.slice(-14).map((c) => ({ role: c.role, text: c.text }));
      void maybeSummarize(
        {
          sessionId: f.sessionId,
          account: f.account,
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
          account: f.account,
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
    const lastUsedAt = Math.max(f.startedAt, t?.lastPromptAt ?? 0, usedAt(f.sessionId));
    const effort = tap?.effort ?? ask?.effort ?? t?.effort ?? this.effortDefaults.get(homeDir(f.account)) ?? null;
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
      lastUsedAt,
      sortKey: sortKey(f.sessionId, lastUsedAt),
      activity,
      summary,
      firstPrompt: t?.firstPrompt ?? null,
      chat,
      git,
      pr,
      story,
      storyId,
      artifacts: [...(t?.artifacts ?? [])].reverse(),
      claims,
      model: tap?.model ?? modelName(t?.model ?? null),
      modelId: tap?.modelId ?? t?.model ?? null,
      effort,
      effortIsDefault: !tap?.effort && !ask?.effort && !t?.effort,
      mode: modeOf(f.sessionId, t),
      contextPercent: tap?.contextPercent ?? null,
      costUsd: tap?.costUsd ?? t?.costUsd ?? null,
      repoName: git ? basename(git.mainRoot) : basename(cwd),
      ide: f.tmux ? null : hostIde(f.pid, procs),
      vscodeLinked: windowFor(shellPid) !== null,
      transcriptPath: path,
      tmux: f.tmux,
      hosted: this.hosted.some((p) => p.name === hostedName(f.tmux)),
      remoteUrl: remoteUrl(f.bridgeSessionId),
      terminal: null,
      agent: null,
      account: f.account,
    };
  }

  /**
   * Another coding agent, such as Codex: a terminal that runs it, with a status read off its screen. A screen that
   * moves is working; one that has stood still a few seconds is done for now, or waits for you.
   */
  private async buildAgent(p: HostedPane): Promise<Session> {
    const s = await this.buildTerminal(p);
    const now = Date.now();
    const text = s.terminal?.screen.join("\n") ?? "";
    const prev = this.screens.get(p.name);
    const moved = !prev || prev.text !== text;
    const changedAt = moved ? now : prev.changedAt;
    const movingSince = moved && prev && now - prev.changedAt < 4_000 ? prev.movingSince : moved ? now : prev.movingSince;
    // Drawing its first screen is not work: what it does after the first seconds is, or at once with a first message.
    const worked = (prev?.worked ?? false) || (moved && (now - p.createdAt > 8_000 || (!!p.prompt && !!prev)));
    this.screens.set(p.name, { text, changedAt, movingSince, worked });
    const a = agentActivity(changedAt, worked, now, settings().inactiveAfterMinutes * 60_000);
    const label = allAgents(settings().agents).find((t) => t.id === p.agent)?.label ?? (p.agent || "Agent");
    const folder = basename(p.cwd) || p.cwd;
    return {
      ...s,
      name: s.nameSource === "saved" ? s.name : `${label} · ${folder}`,
      lastActivityAt: changedAt,
      activity: { ...s.activity, kind: a.kind, label: a.label, since: a.kind === "working" ? movingSince : changedAt },
      summary: { ...s.summary, headline: p.prompt ? p.prompt.slice(0, 160) : s.summary.headline },
      firstPrompt: p.prompt || null,
      terminal: s.terminal && { ...s.terminal, command: label },
      agent: { id: p.agent, label },
    };
  }

  /** A terminal started here: a tile like a session's, with its screen in place of a conversation. */
  private async buildTerminal(p: HostedPane): Promise<Session> {
    const command = SHELLS.test(p.command) ? null : p.command || null;
    const prev = this.commands.get(p.name);
    const since = prev && prev.command === command ? prev.since : prev ? Date.now() : p.createdAt;
    this.commands.set(p.name, { command, since });
    const [git, saved, screen] = await Promise.all([gitInfo(p.cwd, 15_000), savedName(p.name), screenLines(p.name, SCREEN_LINES)]);
    const folder = p.cwd === HOME ? "~" : p.cwd.startsWith(`${HOME}/`) ? `~${p.cwd.slice(HOME.length)}` : p.cwd;
    const lastUsedAt = Math.max(p.createdAt, usedAt(p.name));
    return {
      pid: p.pid,
      shellPid: p.pid,
      sessionId: p.name,
      name: saved ?? (p.cwd === HOME ? "Terminal" : basename(p.cwd)),
      nameSource: saved ? "saved" : "folder",
      shortName: p.name,
      cwd: p.cwd,
      startedAt: p.createdAt,
      lastActivityAt: since,
      lastUsedAt,
      sortKey: sortKey(p.name, lastUsedAt),
      activity: {
        kind: command ? "working" : "idle",
        since,
        label: command ? `Running ${command}` : "Ready",
        detail: null,
        tool: null,
        question: null,
        askedYou: false,
      },
      summary: { headline: folder, now: null, source: "none", updatedAt: null },
      firstPrompt: null,
      chat: [],
      git,
      pr: null,
      story: null,
      storyId: null,
      artifacts: [],
      claims: [],
      model: null,
      modelId: null,
      effort: null,
      effortIsDefault: true,
      mode: null,
      contextPercent: null,
      costUsd: null,
      repoName: git ? basename(git.mainRoot) : basename(p.cwd),
      ide: null,
      vscodeLinked: false,
      transcriptPath: null,
      tmux: p.name,
      hosted: true,
      remoteUrl: null,
      terminal: { command, screen },
      agent: null,
      account: null,
    };
  }
}
