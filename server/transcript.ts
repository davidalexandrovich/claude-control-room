import { open, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ArtifactLink, ChatLine, QuestionPreview, ToolPreview } from "../shared/types.ts";
import { HOME } from "./paths.ts";

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  at: string | null;
}

export interface TranscriptState {
  path: string;
  offset: number; // bytes consumed so far
  inode: number;
  chat: ChatLine[];
  pending: ToolUse[]; // tool calls with no result yet, oldest first
  aiTitle: string | null;
  agentName: string | null;
  lastPrompt: string | null;
  lastPromptAt: number | null; // when you last sent the session a message
  prLink: { number: number; url: string; repo: string } | null;
  artifacts: ArtifactLink[]; // pages it published on claude.ai, the latest last
  worktreePath: string | null;
  worktreeBranch: string | null;
  workedBranches: string[]; // branches this session made, committed to, pushed or opened a PR from
  workedFolders: string[]; // other folders it did that in, as in `cd ../repo-2 && git push`
  recentFolders: string[]; // folders it went to, edited in or added as a worktree, the latest last
  cwd: string | null;
  branch: string | null;
  model: string | null; // raw model id, e.g. "claude-opus-5-5"
  effort: string | null; // from a `/effort` command in this session
  mode: string | null; // the permission mode of the last message
  modeAt: number | null; // when that message was sent
  costUsd: number | null;
  lastAssistantText: string | null;
  lastEntryAt: number | null;
  firstPrompt: string | null;
}

const CHAT_KEEP = 60;
const FIRST_READ_CAP = 12 * 1024 * 1024; // bytes read backwards on first sight of a file
const CHUNK = 1024 * 1024;
const SKIP_TYPES = ['"type":"api-request', '"type":"file-history', '"type":"atis-latch', '"type":"queue-operation'];

export function emptyState(path: string): TranscriptState {
  return {
    path,
    offset: 0,
    inode: 0,
    chat: [],
    pending: [],
    aiTitle: null,
    agentName: null,
    lastPrompt: null,
    lastPromptAt: null,
    prLink: null,
    artifacts: [],
    worktreePath: null,
    worktreeBranch: null,
    workedBranches: [],
    workedFolders: [],
    recentFolders: [],
    cwd: null,
    branch: null,
    model: null,
    effort: null,
    mode: null,
    modeAt: null,
    costUsd: null,
    lastAssistantText: null,
    lastEntryAt: null,
    firstPrompt: null,
  };
}

const states = new Map<string, TranscriptState>();

/** Reads only what is new since the last call; the first call reads backwards from the end. */
export async function readTranscript(path: string): Promise<TranscriptState | null> {
  let info;
  try {
    info = await stat(path);
  } catch {
    states.delete(path);
    return null;
  }
  let state = states.get(path);
  if (state && (state.inode !== info.ino || info.size < state.offset)) state = undefined;
  if (!state) {
    state = emptyState(path);
    state.inode = info.ino;
    await firstRead(state, info.size);
    states.set(path, state);
    return state;
  }
  if (info.size > state.offset) {
    const buf = await readBytes(path, state.offset, info.size);
    // Only whole lines are read; a line still being written waits for the next call.
    const cut = buf.lastIndexOf(0x0a);
    if (cut >= 0) {
      applyLines(state, buf.subarray(0, cut).toString("utf8").split("\n"));
      state.offset += cut + 1;
    }
  }
  return state;
}

async function firstRead(state: TranscriptState, size: number): Promise<void> {
  state.firstPrompt = await readFirstPrompt(state.path);
  // Walk backwards in chunks until enough conversation is in hand or the cap is reached.
  let start = size;
  let buf = Buffer.alloc(0);
  while (start > 0 && size - start < FIRST_READ_CAP) {
    const from = Math.max(0, start - CHUNK);
    buf = Buffer.concat([await readBytes(state.path, from, start), buf]);
    start = from;
    if (countChat(buf) >= CHAT_KEEP) break;
  }
  let begin = 0;
  if (start > 0) {
    const nl = buf.indexOf(0x0a);
    begin = nl >= 0 ? nl + 1 : buf.length;
  }
  const end = buf.lastIndexOf(0x0a);
  if (end < begin) {
    state.offset = start + begin;
    return;
  }
  // Branch work from before that stretch still says whose PR is whose, and a page published then is still its page.
  // They come first, as they happened first.
  if (start + begin > 0) await branchWorkBefore(state, start + begin);
  applyLines(state, buf.subarray(begin, end).toString("utf8").split("\n"));
  state.offset = start + end + 1;
  // A long turn of tool output can push your last message out of that stretch. The list's order needs its time.
  if (state.lastPromptAt === null && start + begin > 0) state.lastPromptAt = await lastPromptBefore(state.path, start + begin);
}

/** The time of your last message before byte `end`, reading backwards up to FIRST_READ_CAP more bytes. */
async function lastPromptBefore(path: string, end: number): Promise<number | null> {
  let start = end;
  let carry = Buffer.alloc(0); // the end part of a line whose start is in the chunk before
  while (start > 0 && end - start < FIRST_READ_CAP) {
    const from = Math.max(0, start - CHUNK);
    const buf = Buffer.concat([await readBytes(path, from, start), carry]);
    start = from;
    const nl = from > 0 ? buf.indexOf(0x0a) : -1;
    carry = nl >= 0 ? buf.subarray(0, nl) : from > 0 ? buf : Buffer.alloc(0);
    if (nl < 0 && from > 0) continue;
    const lines = buf.subarray(nl + 1).toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      // A tool's answer is a user line too, often a big one: it is skipped before it is parsed.
      if (!lines[i].includes('"type":"user"') || lines[i].includes('"tool_result"')) continue;
      const e = parse(lines[i]);
      if (!e || e.type !== "user" || !isYours(e) || !userText(e)) continue;
      const at = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
      if (!Number.isNaN(at)) return at;
    }
  }
  return null;
}

/** Notes the branch work and folders in bytes 0 to `end`. Only a line with a commit, push, new branch, edit or cd is parsed. */
async function branchWorkBefore(state: TranscriptState, end: number): Promise<void> {
  let carry = Buffer.alloc(0); // the start of a line whose end is in the next chunk
  for (let from = 0; from < end; from += CHUNK) {
    const buf = Buffer.concat([carry, await readBytes(state.path, from, Math.min(end, from + CHUNK))]);
    const nl = buf.lastIndexOf(0x0a);
    carry = buf.subarray(nl + 1);
    for (const raw of buf.subarray(0, nl + 1).toString("utf8").split("\n")) {
      if (raw.includes('"artifact_id"')) {
        const e = parse(raw);
        if (e?.type === "user" && !e.isSidechain) noteArtifact(state, e.toolUseResult);
      }
      const shell = raw.includes("<bash-input>") || raw.includes('"name":"Bash"');
      const branchy = shell && (BRANCH_WORK.test(raw) || raw.search(BRANCH_MADE) >= 0);
      const moved = (shell && FOLDER_HINT.test(raw)) || EDIT_HINT.test(raw);
      if (!branchy && !moved) continue;
      const e = parse(raw);
      if (!e || e.isMeta || e.isSidechain) continue;
      const said = e.type === "user" ? userText(e) : null;
      if (said?.startsWith("! ")) noteBranchWork(state, said.slice(2), e.gitBranch, e.cwd);
      if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
      for (const block of e.message.content) {
        if (block?.type !== "tool_use") continue;
        if (block.name === "Bash" && typeof block.input?.command === "string") noteBranchWork(state, block.input.command, e.gitBranch, e.cwd);
        noteFolder(state, { id: "", name: String(block.name ?? ""), input: block.input ?? {}, at: null }, e.cwd);
      }
    }
  }
}

function countChat(buf: Buffer): number {
  let n = 0;
  for (const needle of ['"type":"user"', '"type":"assistant"']) {
    let i = buf.indexOf(needle);
    while (i >= 0) {
      n++;
      i = buf.indexOf(needle, i + needle.length);
    }
  }
  return n;
}

async function readBytes(path: string, from: number, to: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(Math.max(0, to - from));
    const { bytesRead } = await handle.read(buf, 0, buf.length, from);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readFirstPrompt(path: string): Promise<string | null> {
  let text: string;
  try {
    text = (await readBytes(path, 0, Math.min((await stat(path)).size, 512 * 1024))).toString("utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    if (!line.includes('"type":"user"')) continue;
    const entry = parse(line);
    if (!entry || entry.type !== "user" || entry.isMeta) continue;
    const said = userText(entry);
    if (said && !said.startsWith("/")) return said;
  }
  return null;
}

type Entry = Record<string, any>;

function parse(line: string): Entry | null {
  if (!line || line[0] !== "{") return null;
  const head = line.slice(0, 120);
  if (SKIP_TYPES.some((t) => head.includes(t))) return null;
  try {
    return JSON.parse(line) as Entry;
  } catch {
    return null;
  }
}

export function applyLines(state: TranscriptState, lines: string[]): void {
  for (const line of lines) {
    const entry = parse(line);
    if (entry) applyEntry(state, entry);
  }
  if (state.chat.length > CHAT_KEEP) state.chat.splice(0, state.chat.length - CHAT_KEEP);
  if (state.pending.length > 20) state.pending.splice(0, state.pending.length - 20);
}

function applyEntry(state: TranscriptState, e: Entry): void {
  if (typeof e.timestamp === "string") {
    const t = Date.parse(e.timestamp);
    if (!Number.isNaN(t)) state.lastEntryAt = Math.max(state.lastEntryAt ?? 0, t);
  }
  if (typeof e.cwd === "string" && e.isSidechain !== true) state.cwd = e.cwd;
  if (typeof e.gitBranch === "string" && e.gitBranch && e.isSidechain !== true) state.branch = e.gitBranch;
  switch (e.type) {
    case "ai-title":
      if (typeof e.aiTitle === "string") state.aiTitle = e.aiTitle;
      return;
    case "agent-name":
      if (typeof e.agentName === "string") state.agentName = e.agentName;
      return;
    case "custom-title":
      if (typeof e.customTitle === "string") state.agentName = e.customTitle;
      return;
    case "last-prompt":
      if (typeof e.lastPrompt === "string") state.lastPrompt = e.lastPrompt;
      return;
    case "pr-link":
      if (typeof e.prNumber === "number") {
        state.prLink = { number: e.prNumber, url: String(e.prUrl ?? ""), repo: String(e.prRepository ?? "") };
      }
      return;
    case "worktree-state": {
      const w = e.worktreeSession;
      state.worktreePath = w && typeof w.worktreePath === "string" ? w.worktreePath : null;
      state.worktreeBranch = w && typeof w.worktreeBranch === "string" ? w.worktreeBranch : null;
      return;
    }
    case "relocated":
      if (typeof e.relocatedCwd === "string") state.cwd = e.relocatedCwd;
      return;
    case "permission-mode":
      // Written with each message, and on its own when a session resumes.
      if (typeof e.permissionMode === "string" && e.isSidechain !== true) state.mode = e.permissionMode;
      return;
    case "cost-state":
      if (typeof e.totalCostUSD === "number") state.costUsd = e.totalCostUSD;
      return;
    case "system":
      if (e.subtype === "local_command" && typeof e.content === "string") readCommandOutput(state, e.content);
      return;
    case "user":
      if (e.isSidechain) return;
      applyUser(state, e);
      return;
    case "assistant":
      if (e.isSidechain) return;
      applyAssistant(state, e);
      return;
  }
}

function readCommandOutput(state: TranscriptState, content: string): void {
  const effort = /Set effort level to (\w+)/.exec(content);
  if (effort) state.effort = effort[1].toLowerCase();
}

// A command that makes a branch puts what follows on it; any other commit, push or new PR is on the branch it ran on.
const BRANCH_MADE = /\bgit\s+(?:checkout\s+-[bB]|switch\s+(?:-[cC]|--create|--force-create))\s+([^\s;&|]+)/g;
const BRANCH_WORK = /\bgit\s+(?:-C\s+(?:"[^"]+"|'[^']+'|\S+)\s+)?(?:commit|push)\b|\bgh\s+pr\s+create\b/;
// The transcript names the branch of the session's own folder; a command that goes elsewhere first works there.
const ELSEWHERE = /(?:^|[;&|]\s*)cd\s+("[^"]+"|'[^']+'|(?:\\.|[^\s;&|\\])+)|\bgit\s+-C\s+("[^"]+"|'[^']+'|(?:\\.|[^\s;&|\\])+)/;

/** Notes the branches a shell command worked on, from Claude or typed after `!`. */
function noteBranchWork(state: TranscriptState, command: string, branch: unknown, cwd: unknown): void {
  const made = [...command.matchAll(BRANCH_MADE)].map((m) => m[1]);
  if (!made.length && !BRANCH_WORK.test(command)) return;
  const away = ELSEWHERE.exec(command);
  if (away) {
    const dir = unquote(away[1] ?? away[2]);
    const folder = resolve(typeof cwd === "string" ? cwd : (state.cwd ?? HOME), dir);
    state.workedFolders = [...state.workedFolders.filter((x) => x !== folder), folder].slice(-5);
    return;
  }
  const worked = made.length ? made : typeof branch === "string" && branch ? [branch] : [];
  for (const b of worked) {
    state.workedBranches = [...state.workedBranches.filter((x) => x !== b), b].slice(-20);
  }
}

const WORKTREE_ADD = /\bgit\s+(?:-C\s+("[^"]+"|'[^']+'|(?:\\.|[^\s;&|\\])+)\s+)?worktree\s+add\s+(?:(?:-[bB]\s+[^\s;&|]+|-\S+)\s+)*("[^"]+"|'[^']+'|(?:\\.|[^\s;&|\\])+)/;
// What a raw line holds before it is worth parsing for a folder.
const FOLDER_HINT = /\bcd\s|\bgit\s+-C\s|\bworktree\s+add\b/;
const EDIT_HINT = /"name":"(?:Edit|MultiEdit|Write|NotebookEdit)"/;

/** A shell word as a path: quotes and backslashes dropped, ~ for home. */
function unquote(word: string): string {
  const bare = /^(["'])(.*)\1$/.exec(word)?.[2] ?? word.replace(/\\(.)/g, "$1");
  return bare.replace(/^~(?=$|\/)/, HOME);
}

/**
 * Notes the folder a tool call worked in. A session that starts in a shared checkout often works in a worktree
 * beside it, by `cd ../shield-27336 && …` or edits there; its own folder never changes, since Claude Code goes back.
 */
function noteFolder(state: TranscriptState, use: ToolUse, cwd: unknown): void {
  const base = typeof cwd === "string" ? cwd : (state.cwd ?? HOME);
  const path = (raw: string, from = base) => resolve(from, unquote(raw));
  let folder: string | null = null;
  const file = use.input.file_path ?? use.input.notebook_path;
  if (["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(use.name) && typeof file === "string" && isAbsolute(file)) folder = dirname(file);
  else if (use.name === "Bash" && typeof use.input.command === "string") {
    const added = WORKTREE_ADD.exec(use.input.command);
    const away = ELSEWHERE.exec(use.input.command);
    if (added) folder = path(added[2], added[1] ? path(added[1]) : base);
    else if (away) folder = path(away[1] ?? away[2]);
  }
  // Room for scratchpads and memory folders, which are no checkout, without losing the worktree before them.
  if (folder) state.recentFolders = [...state.recentFolders.filter((x) => x !== folder), folder].slice(-10);
}

const ARTIFACT_URL = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+$/;

/** A publish by the Artifact tool, whose result names the page. Reads and uploads name no artifact_id and url both. */
function noteArtifact(state: TranscriptState, result: unknown): void {
  const r = result as Record<string, unknown> | null;
  if (!r || typeof r.artifact_id !== "string" || typeof r.url !== "string" || !ARTIFACT_URL.test(r.url)) return;
  const page = { url: r.url, title: typeof r.title === "string" && r.title ? r.title : null };
  state.artifacts = [...state.artifacts.filter((a) => a.url !== page.url), page].slice(-10);
}

function applyUser(state: TranscriptState, e: Entry): void {
  noteArtifact(state, e.toolUseResult);
  const content = e.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
        state.pending = state.pending.filter((p) => p.id !== block.tool_use_id);
      }
    }
  }
  if (e.isMeta) return;
  if (typeof e.permissionMode === "string") {
    state.mode = e.permissionMode;
    const at = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
    if (!Number.isNaN(at)) state.modeAt = at;
  }
  const said = userText(e);
  if (said?.startsWith("! ")) noteBranchWork(state, said.slice(2), e.gitBranch, e.cwd);
  if (said) {
    state.pending = [];
    state.chat.push({ role: "user", text: said, at: e.timestamp ?? null });
    const at = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
    if (!Number.isNaN(at) && isYours(e)) state.lastPromptAt = Math.max(state.lastPromptAt ?? 0, at);
  }
}

/** A message you sent. Claude Code writes its own summary as a user message when it compacts; that one is not yours. */
function isYours(e: Entry): boolean {
  return !e.isMeta && !e.isSidechain && !e.isCompactSummary && !e.isVisibleInTranscriptOnly;
}

function applyAssistant(state: TranscriptState, e: Entry): void {
  const msg = e.message ?? {};
  if (typeof msg.model === "string" && msg.model !== "<synthetic>") state.model = msg.model;
  const content = Array.isArray(msg.content) ? msg.content : [];
  const texts: string[] = [];
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      texts.push(block.text.trim());
    } else if (block?.type === "tool_use" && typeof block.id === "string") {
      const use: ToolUse = { id: block.id, name: String(block.name ?? "tool"), input: block.input ?? {}, at: e.timestamp ?? null };
      state.pending.push(use);
      if (use.name === "Bash" && typeof use.input.command === "string") noteBranchWork(state, use.input.command, e.gitBranch, e.cwd);
      noteFolder(state, use, e.cwd);
      const p = describeTool(use.name, use.input);
      state.chat.push({ role: "tool", text: p.detail ? `${p.action}: ${p.detail}` : p.action, at: use.at });
    }
  }
  if (texts.length) {
    const text = texts.join("\n\n");
    state.lastAssistantText = text;
    state.chat.push({ role: "assistant", text, at: e.timestamp ?? null });
  }
}

const NOISE = /<(system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|task-notification|command-message)>[\s\S]*?<\/\1>/g;

/** The words a person typed, or null for tool results and machine-made messages. */
export function userText(e: Entry): string | null {
  const content = e.message?.content;
  let raw = "";
  if (typeof content === "string") raw = content;
  else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
      else if (block?.type === "image") parts.push("[image]");
    }
    raw = parts.join("\n");
  }
  if (!raw) return null;
  const command = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(raw);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1]?.trim();
    return `${command[1].startsWith("/") ? "" : "/"}${command[1]}${args ? ` ${args}` : ""}`;
  }
  const bash = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(raw);
  if (bash) return `! ${bash[1].trim()}`;
  if (/^<(bash-stdout|bash-stderr)>/.test(raw.trim())) return null;
  const text = raw
    .replace(NOISE, "")
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, "[pasted text]")
    .trim();
  if (!text) return null;
  if (text.startsWith("[Request interrupted")) return "⏹ Interrupted";
  if (text.startsWith("Caveat:")) return null;
  return text;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function short(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

function firstLine(text: string | null, max = 160): string | null {
  if (!text) return null;
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function pretty(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Turns a tool call into plain words a non-technical reader understands. */
export function describeTool(name: string, input: Record<string, unknown>): ToolPreview {
  const make = (action: string, detail: string | null): ToolPreview => ({ tool: name, action, detail });
  switch (name) {
    case "Bash":
      return make("Run a command", firstLine(str(input.description)) ?? firstLine(str(input.command)));
    case "BashOutput":
    case "KillShell":
    case "Monitor":
    case "TaskStop":
      return make("Check a background task", firstLine(str(input.description)));
    case "Read":
      return make("Read a file", short(str(input.file_path)));
    case "Edit":
    case "MultiEdit":
      return make("Edit a file", short(str(input.file_path)));
    case "Write":
      return make("Write a file", short(str(input.file_path)));
    case "NotebookEdit":
      return make("Edit a notebook", short(str(input.notebook_path)));
    case "Grep":
      return make("Search the code", firstLine(str(input.pattern), 80));
    case "Glob":
      return make("Find files", firstLine(str(input.pattern), 80));
    case "WebFetch": {
      const url = str(input.url);
      let host: string | null = url;
      try {
        host = url ? new URL(url).host : null;
      } catch {
        /* keep the raw url */
      }
      return make("Open a web page", host);
    }
    case "WebSearch":
      return make("Search the web", firstLine(str(input.query), 100));
    case "Task":
    case "Agent":
      return make("Start a helper agent", firstLine(str(input.description)));
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return make("Update its task list", null);
    case "AskUserQuestion": {
      const qs = Array.isArray(input.questions) ? input.questions : [];
      return make("Ask you a question", firstLine(str((qs[0] as Record<string, unknown>)?.question)));
    }
    case "ExitPlanMode":
      return make("Show you a plan", null);
    case "EnterWorktree":
      return make("Move into a worktree", short(str(input.path)));
    case "Skill":
      return make("Use a skill", str(input.skill));
    case "Workflow":
      return make("Run a workflow", null);
    case "SendMessage":
      return make("Message another session", str(input.to));
    case "Artifact":
      return make("Publish a page", null);
    case "ToolSearch":
      return make("Load more tools", null);
    case "ScheduleWakeup":
      return make("Schedule a check-in", null);
  }
  if (name.startsWith("mcp__")) {
    const [, server = "", tool = ""] = name.split("__");
    const service = pretty(server.replace(/^claude_ai_/, ""));
    return make(`Use ${service}`, pretty(tool));
  }
  return make(`Use ${pretty(name)}`, null);
}

/** The question form of a pending AskUserQuestion call. */
export function questionOf(use: ToolUse | null): QuestionPreview | null {
  if (!use || use.name !== "AskUserQuestion") return null;
  const qs = Array.isArray(use.input.questions) ? (use.input.questions as Record<string, unknown>[]) : [];
  const q = qs[0];
  if (!q) return null;
  const options = Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : [];
  return {
    question: str(q.question) ?? "",
    header: str(q.header),
    options: options.map((o) => ({ label: str(o.label) ?? "", description: str(o.description) })),
    multiSelect: q.multiSelect === true,
    count: qs.length,
  };
}

/** "claude-opus-5-5" → "Opus 5.5" */
export function modelName(id: string | null): string | null {
  if (!id) return null;
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/.exec(id);
  if (!m) return id;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return m[3] ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`;
}
