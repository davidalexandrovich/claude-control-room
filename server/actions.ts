import { existsSync } from "node:fs";
import { claudeCommand, isEffort, isMode, isModel, modeName, modelAlias, MODELS } from "../shared/claude.ts";
import { openTarget } from "../shared/ides.ts";
import type { ActionResult, ClosePlan, CloseRequest, Session, WorktreeReport } from "../shared/types.ts";
import { accountByDir, homeDir } from "./homes.ts";
import { chromeArgs, chromeProfiles, profileOf } from "./chrome.ts";
import { endClaim, forgetClaims, repoClaims } from "./claims.ts";
import { folderSetting, settings } from "./config.ts";
import { git, listWorktrees } from "./git.ts";
import { prForBranch, type PrRow } from "./github.ts";
import { stopConsole } from "./console.ts";
import { hostedName, hostedSessions, startSession, startShell, tmux, tmuxReady } from "./hosted.ts";
import { chosenIde, openInIde } from "./ide.ts";
import type { Monitor } from "./monitor.ts";
import { findTranscript, noteMode, readSessionFiles, type SessionFile } from "./monitor.ts";
import { cleanName, saveName } from "./names.ts";
import { launch, run, sleep } from "./proc.ts";
import { CLEAR_DRAFT, REMOTE_COMMAND, remoteRefusal } from "./remote.ts";
import { place } from "./order.ts";
import { keepDefaults, readTap, type Tap } from "./statusline.ts";
import { closeTerminal, focusTerminal, renameTerminal, sendText } from "./vscode.ts";
import { buildReport, insidePath, worksIn } from "./worktrees.ts";

const KEYS = { enter: "\r", escape: "\u001b" } as const;

function find(monitor: Monitor, pid: number): Session | null {
  return monitor.snapshot?.sessions.find((s) => s.pid === pid) ?? null;
}

async function freshStatus(pid: number): Promise<{ status: string | null; waitingFor: string | null; bridgeSessionId: string | null } | null> {
  const f = (await readSessionFiles()).find((x) => x.pid === pid);
  return f ? { status: f.status, waitingFor: f.waitingFor, bridgeSessionId: f.bridgeSessionId } : null;
}

/**
 * Runs a tmux command on the session's pane. A session started here lives on Control Room's own tmux server; pane ids
 * like %0 count per server. Its name decides, not the last list from tmux, so a key never lands in a pane of the same
 * id on your own tmux.
 */
function paneTmux(s: Session & { tmux: string }, command: string, ...args: string[]) {
  const full = [command, "-t", s.tmux.split(".").pop() ?? s.tmux, ...args];
  return hostedName(s.tmux) ? tmux(full) : run("tmux", full, { timeoutMs: 5_000 });
}

/** Sends raw keys to the terminal that runs the session: tmux directly, VS Code through the helper. */
async function sendKeys(s: Session, text: string, tmuxKey: string | null): Promise<ActionResult> {
  if (s.tmux) {
    const out = await paneTmux({ ...s, tmux: s.tmux }, "send-keys", ...(tmuxKey ? [tmuxKey] : ["-l", text]));
    return { ok: out.ok, message: out.ok ? "Sent" : out.stderr.trim() };
  }
  if (s.vscodeLinked) {
    const r = await sendText(s.shellPid, text);
    return { ok: r.ok, message: r.message };
  }
  if (s.desktopUrl) return { ok: false, message: "It runs in the Claude app. Answer it there (Open in Claude)." };
  return { ok: false, message: "This terminal can't receive keys from the dashboard. Open the session instead." };
}

async function settle(pid: number, from: string): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    const now = await freshStatus(pid);
    if (!now || now.status !== from) return true;
  }
  return false;
}

export async function answerPermission(monitor: Monitor, pid: number, approve: boolean): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  // Re-read the status right now: a stale card must never press Enter into a prompt that moved on.
  const now = await freshStatus(pid);
  if (!now || now.status !== "waiting" || !(now.waitingFor ?? "").includes("permission")) {
    return { ok: false, message: "The session is no longer waiting for approval." };
  }
  const r = await sendKeys(s, approve ? KEYS.enter : KEYS.escape, approve ? "Enter" : "Escape");
  if (!r.ok) return r;
  const moved = await settle(pid, "waiting");
  await monitor.tick();
  return { ok: true, message: moved ? (approve ? "Approved" : "Rejected") : "Sent — the session has not moved yet" };
}

export async function answerQuestion(monitor: Monitor, pid: number, option: number): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  const now = await freshStatus(pid);
  const q = s.activity.question;
  if (!now || now.status !== "waiting" || !(now.waitingFor ?? "").includes("input") || !q) {
    return { ok: false, message: "The session is no longer asking." };
  }
  if (q.count !== 1 || q.multiSelect || option < 0 || option >= q.options.length || option > 8) {
    return { ok: false, message: "Answer this one in the terminal." };
  }
  const digit = String(option + 1);
  const r = await sendKeys(s, digit, null);
  if (!r.ok) return r;
  await settle(pid, "waiting");
  await monitor.tick();
  return { ok: true, message: `Answered “${q.options[option].label}”` };
}

/** Types /remote-control into the session, as you would by hand. Claude Code runs it at once, even mid-turn. */
export async function startRemoteControl(monitor: Monitor, pid: number): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  if (s.desktopUrl) return { ok: false, message: `${IN_DESKTOP} Use Remote Control from the app.` };
  if (!s.tmux && !s.vscodeLinked) {
    const helper = s.ide === "vscode" ? ", or install the VS Code helper (Settings)" : "";
    return { ok: false, message: `Control Room can't type in this terminal. Type /rc in the session${helper}.` };
  }
  const before = await freshStatus(pid);
  // A second /remote-control would open Claude Code's Remote Control menu in the terminal.
  if (before?.bridgeSessionId) return { ok: true, message: "It is already on your phone." };
  const refused = remoteRefusal(before);
  if (refused) return { ok: false, message: refused };
  for (const [text, key] of [...CLEAR_DRAFT, [REMOTE_COMMAND, null] as const]) {
    const r = await sendKeys(s, text, key);
    if (!r.ok) return r;
  }
  await sleep(300);
  // Look again right before Enter: a prompt that opened meanwhile would take Enter as "yes".
  const late = remoteRefusal(await freshStatus(pid));
  if (late) return { ok: false, message: late };
  const r = await sendKeys(s, KEYS.enter, "Enter");
  if (!r.ok) return r;
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    if ((await freshStatus(pid))?.bridgeSessionId) {
      await monitor.tick();
      return { ok: true, message: "On your phone now: open the Claude app and tap Code." };
    }
  }
  return { ok: false, message: "Sent /remote-control, but it did not connect. Look at the session to see why." };
}

const MOVE_HINT = "Move it here first (Move here, in its details).";
const IN_DESKTOP = "It runs in the Claude app.";

/** Why the session's model, effort or mode can't change from here right now, or null when it can. */
async function tuneRefusal(s: Session, what: "model" | "effort" | "mode"): Promise<string | null> {
  if (s.desktopUrl) return `${IN_DESKTOP} Change its ${what} there.`;
  if (what === "mode" ? !s.tmux : !s.tmux && !s.vscodeLinked) {
    // The mode moves one Shift+Tab at a time, so Control Room has to see the screen to know where it is.
    return what === "mode" && s.vscodeLinked
      ? `Press Shift+Tab in its terminal to change the mode, or ${MOVE_HINT.toLowerCase()}`
      : `Control Room can't type in this terminal. ${MOVE_HINT}`;
  }
  const now = await freshStatus(s.pid);
  if (!now) return "That session is gone.";
  // An open prompt takes every key: Shift+Tab there approves edits for the rest of the session.
  if (now.status === "waiting") return "Answer the session first, then try again.";
  // A command typed during a turn waits for the turn to end, after the saved default was put back.
  if (what !== "mode" && now.status !== "idle") return `Wait until it is idle. Claude Code changes the ${what} between turns.`;
  return null;
}

/** Types a slash command into an idle session, the way /remote-control goes in. */
async function typeCommand(s: Session, command: string): Promise<ActionResult> {
  // The space closes the command menu, so Enter runs this command and never a suggestion still on screen.
  for (const [text, key] of [...CLEAR_DRAFT, [`${command} `, null] as const]) {
    const r = await sendKeys(s, text, key);
    if (!r.ok) return r;
  }
  await sleep(300);
  if ((await freshStatus(s.pid))?.status !== "idle") {
    for (const [text, key] of CLEAR_DRAFT) await sendKeys(s, text, key);
    return { ok: false, message: "It started something meanwhile, so nothing changed." };
  }
  return sendKeys(s, KEYS.enter, "Enter");
}

// Claude Code asks first when the conversation is cached: "Switch model?" or "Change effort level?", Yes chosen.
export const ASKS_TO_SWITCH = /(Switch model|Change effort level)\?[\s\S]*❯ 1\. Yes/;

/** Whether the question on screen is Claude Code asking to confirm the switch just typed. */
async function asksToSwitch(s: Session): Promise<boolean> {
  // A VS Code terminal can't be read; it was idle right before the command, so the command is what asks.
  if (!s.tmux) return true;
  const out = await paneTmux({ ...s, tmux: s.tmux }, "capture-pane", "-p");
  return out.ok && ASKS_TO_SWITCH.test(out.stdout);
}

/**
 * Waits for the status line to report what the command changed; it can lag a few seconds behind. When Claude Code asks
 * to confirm first, this says yes, as you would: the switch is what you picked. It happens here, while your defaults
 * are kept, because Claude Code saves the new one as your default right when you say yes.
 */
async function switched(s: Session, done: (t: Tap) => boolean): Promise<Tap | null> {
  let confirmed = false;
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    const t = await readTap(s.sessionId);
    if (t && done(t)) return t;
    if (!confirmed && (await freshStatus(s.pid))?.status === "waiting" && (await asksToSwitch(s))) {
      confirmed = true;
      if (!(await sendKeys(s, KEYS.enter, "Enter")).ok) return null;
    }
  }
  return null;
}

export async function setModel(monitor: Monitor, pid: number, model: unknown): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  if (!isModel(model)) return { ok: false, message: "That is not a model name." };
  const label = MODELS.find((m) => m.id === model)?.label ?? model;
  if (modelAlias(s.modelId) === model) return { ok: true, message: `It already runs ${label}.` };
  const refused = await tuneRefusal(s, "model");
  if (refused) return { ok: false, message: refused };
  const out = await keepDefaults(async () => {
    const sent = await typeCommand(s, `/model ${model}`);
    if (!sent.ok) return sent;
    const t = await switched(s, (x) => modelAlias(x.modelId) === model);
    await sleep(300); // Claude Code saves the default right around the time it reports the change
    return t ? { ok: true, message: `Now on ${t.model ?? label}` } : { ok: true, message: `Sent /model ${model}. If it did not change, look at the session to see why.` };
  }, homeDir(s.account));
  await monitor.tick();
  return out;
}

export async function setEffort(monitor: Monitor, pid: number, effort: unknown): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  if (!isEffort(effort)) return { ok: false, message: "That is not an effort level." };
  if (s.effort === effort && !s.effortIsDefault) return { ok: true, message: `Effort is ${effort} already.` };
  const refused = await tuneRefusal(s, "effort");
  if (refused) return { ok: false, message: refused };
  const out = await keepDefaults(async () => {
    const sent = await typeCommand(s, `/effort ${effort}`);
    if (!sent.ok) return sent;
    const t = await switched(s, (x) => x.effort === effort);
    await sleep(300);
    return t ? { ok: true, message: `Effort set to ${effort}` } : { ok: true, message: `Sent /effort ${effort}. If it did not change, look at the session to see why.` };
  }, homeDir(s.account));
  await monitor.tick();
  return out;
}

const MODE_LINES: [RegExp, string][] = [
  [/auto mode on/i, "auto"],
  [/manual mode on/i, "manual"],
  [/accept edits on/i, "acceptEdits"],
  [/plan mode on/i, "plan"],
  [/bypass permissions on/i, "bypassPermissions"],
];

/** The permission mode Claude Code shows under its prompt, read off the pane. */
async function screenMode(s: Session & { tmux: string }): Promise<string | null> {
  const out = await paneTmux(s, "capture-pane", "-p");
  if (!out.ok) return null;
  const bottom = out.stdout.split("\n").filter((l) => l.trim()).slice(-4).join("\n");
  return MODE_LINES.find(([re]) => re.test(bottom))?.[1] ?? null;
}

/** Presses Shift+Tab until the mode under the prompt is the one asked for, as you would by hand. */
export async function setMode(monitor: Monitor, pid: number, mode: unknown): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  if (!isMode(mode)) return { ok: false, message: "That is not a permission mode." };
  const refused = await tuneRefusal(s, "mode");
  if (refused || !s.tmux) return { ok: false, message: refused ?? MOVE_HINT };
  const pane = { ...s, tmux: s.tmux };
  const start = await screenMode(pane);
  if (!start) return { ok: false, message: "Control Room could not read the mode on its screen. Close any open menu in the session and try again." };
  let current = start;
  for (let i = 0; i < 6 && current !== mode; i++) {
    if ((await freshStatus(pid))?.status === "waiting") return { ok: false, message: `It asked something meanwhile. The mode is ${modeName(current)}.` };
    const r = await sendKeys(s, "\u001b[Z", "BTab");
    if (!r.ok) return r;
    const was = current;
    for (let j = 0; j < 8 && current === was; j++) {
      await sleep(100);
      current = (await screenMode(pane)) ?? current;
    }
    // Back where it started: this session's cycle has no such mode.
    if (current === start) break;
  }
  if (current !== mode) return { ok: false, message: `Its Shift+Tab cycle has no ${modeName(mode)} mode. It is in ${modeName(current)} mode.` };
  noteMode(s.sessionId, mode);
  await monitor.tick();
  return { ok: true, message: `Mode set to ${modeName(mode)}` };
}

/** Puts a session where its card was dropped: between the cards `above` and `below` in the list you saw. */
export async function placeSession(monitor: Monitor, pid: number, b: { above?: unknown; below?: unknown }): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  const keyOf = (other: unknown) => (typeof other === "number" && other !== pid ? (find(monitor, other)?.sortKey ?? null) : null);
  await place(s.sessionId, keyOf(b.above), keyOf(b.below));
  await monitor.fresh();
  return { ok: true, message: "Moved" };
}

export async function focusSession(monitor: Monitor, pid: number): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  const target = openTarget(s, chosenIde(settings().ide));
  // The page opens the console itself; this answers a menu or a keyboard shortcut that asked the server.
  if (target.kind === "console") return { ok: true, message: "Its console is in Control Room." };
  if (target.kind === "desktop") {
    launch("open", [s.desktopUrl!]);
    return { ok: true, message: "Opened in Claude" };
  }
  if (target.kind === "tmux") {
    launch("open", ["-a", "Terminal"]);
    return { ok: true, message: `It runs in tmux (${(s.tmux ?? "").split(":")[0]}).` };
  }
  // A VS Code session goes through the helper: it jumps to the session's terminal, or says how to get that jump.
  if (s.ide === "vscode") {
    const r = await focusTerminal(s.shellPid);
    return { ok: r.ok, message: r.ok ? "Opened in VS Code" : r.message };
  }
  return openInIde(target.ide, s.git?.root ?? s.cwd, !!s.git);
}

/** Opens the session's folder in the IDE from Settings, to see its changes. A session in a console here has no IDE of its own. */
export async function openFolderInIde(monitor: Monitor, pid: number): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  return openInIde(chosenIde(settings().ide), s.git?.root ?? s.cwd, !!s.git);
}

/**
 * Renames the session's VS Code tab, and the tile takes the tab's name. A session outside VS Code keeps its name in
 * Control Room; an empty name there brings back the name Claude Code gives it.
 */
export async function renameSession(monitor: Monitor, pid: number, raw: unknown): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  const name = cleanName(raw);
  if (s.ide === "vscode") {
    // A name saved here would lose to the tab's name once the helper connects, so VS Code tabs go through the helper only.
    if (!name) return { ok: false, message: "Type a name first." };
    if (!s.vscodeLinked) return { ok: false, message: "Rename works for sessions in a VS Code terminal, with the VS Code helper (Settings)." };
    const r = await renameTerminal(s.shellPid, name);
    if (!r.ok) return r;
  } else {
    if (!name && s.nameSource !== "saved") return { ok: false, message: "Type a name first." };
    try {
      await saveName(s.sessionId, name);
    } catch (err) {
      return { ok: false, message: `The name was not saved: ${(err as Error).message}` };
    }
  }
  await monitor.tick();
  return { ok: true, message: name ? `Renamed to “${name}”` : "Name cleared" };
}

/** The session file of the Claude Code that runs in hosted tmux session `name`, once Claude Code has written it. */
async function hostedFile(name: string, waitMs: number): Promise<SessionFile | null> {
  for (const until = Date.now() + waitMs; ; await sleep(250)) {
    const f = (await readSessionFiles()).find((x) => hostedName(x.tmux) === name);
    if (f) return f;
    if (Date.now() > until) return null;
  }
}

interface NewSessionBody {
  cwd?: unknown;
  prompt?: unknown;
  model?: unknown;
  effort?: unknown;
  mode?: unknown;
  account?: unknown; // the config folder of an account in Settings; left out, the usual one
}

/** Starts Claude Code in Control Room, in a folder of your choice, with an optional first message. */
export async function newSession(monitor: Monitor, b: NewSessionBody): Promise<ActionResult & { pid?: number; name?: string }> {
  const prompt = typeof b.prompt === "string" && b.prompt.trim() ? b.prompt.trim() : null;
  // Left out, each one is Claude Code's own default.
  const model = isModel(b.model) ? b.model : null;
  const effort = isEffort(b.effort) ? b.effort : null;
  const mode = isMode(b.mode) ? b.mode : null;
  // Only an account from Settings: the folder becomes CLAUDE_CONFIG_DIR.
  const account = b.account ? accountByDir(b.account) : null;
  if (b.account && !account) return { ok: false, message: "That account is not in Settings any more." };
  const r = await startSession({ cwd: typeof b.cwd === "string" ? b.cwd : "", prompt, model, effort, mode, account });
  if (!r.ok || !r.name) return r;
  // Claude Code writes its session file within a second or two; a longer wait means it asks something first.
  const file = await hostedFile(r.name, 5_000);
  if (!file && (await hostedSessions())?.has(r.name) === false) return { ok: false, message: STOPPED_AT_START };
  if (file && mode) noteMode(file.sessionId, mode);
  await monitor.fresh();
  return file
    ? { ok: true, message: "Started", pid: file.pid, name: r.name }
    : { ok: true, message: "Claude Code asks something first. Answer it in the console.", name: r.name };
}

const STOPPED_AT_START = "Claude Code stopped right after it started. Run claude in that folder in a terminal once to see why.";
const moving = new Set<number>();

/**
 * Moves a session from another terminal into Control Room: stops it, then continues the same conversation here with
 * `claude --resume`. Only an idle session moves, so no turn is cut off.
 */
export async function moveSession(monitor: Monitor, pid: number): Promise<ActionResult & { pid?: number; name?: string }> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  if (s.hosted) return { ok: true, message: "It already runs in Control Room.", pid };
  // The app owns the session: resuming it here would leave the app's tab talking to nothing.
  if (s.desktopUrl) return { ok: false, message: `${IN_DESKTOP} Keep using it there.` };
  // A second click, or a second window, must not resume the same conversation twice.
  if (moving.has(pid)) return { ok: false, message: "It is moving already." };
  moving.add(pid);
  try {
    const file = (await readSessionFiles()).find((x) => x.pid === pid);
    if (!file || file.status !== "idle" || !["idle", "inactive"].includes(s.activity.kind)) {
      return { ok: false, message: "Wait until it is idle. Moving restarts Claude Code, so a running turn or background task would stop." };
    }
    // Everything a restart here needs is checked before Claude Code stops there.
    if (!tmuxReady()) return { ok: false, message: "Control Room needs tmux for this. Install it: brew install tmux" };
    if (!existsSync(file.cwd)) return { ok: false, message: `Its folder is gone: ${file.cwd}` };
    // Claude Code saves a conversation at its first message; one with none has nothing to resume, so it starts fresh.
    const resume = (await findTranscript(s.sessionId, file.cwd, file.account, true)) ? s.sessionId : undefined;
    if (!(await stopProcess(pid))) return { ok: false, message: "Claude did not stop, so the session stays where it is." };
    const claude = claudeCommand(file.account);
    const resumeHint = resume ? `To continue it yourself, run in ${file.cwd}: ${claude} --resume ${resume}` : `To start it yourself, run ${claude} in ${file.cwd}`;
    // It keeps its model, effort and mode: a resumed session would start on your defaults.
    const mode = s.mode === "default" ? "manual" : s.mode;
    const keep = {
      model: isModel(s.modelId) ? s.modelId : null,
      effort: !s.effortIsDefault && isEffort(s.effort) ? s.effort : null,
      mode: isMode(mode) ? mode : null,
    };
    // Claude Code keeps a conversation under the folder it started in, and in its account's config folder, so it
    // continues from both.
    const r = await startSession({ cwd: file.cwd, resume, account: file.account, ...keep });
    if (!r.ok || !r.name) return { ok: false, message: `It stopped, but did not start here: ${r.message} ${resumeHint}` };
    const fileHere = await hostedFile(r.name, 15_000);
    const pidHere = fileHere?.pid ?? null;
    if (!pidHere && (await hostedSessions())?.has(r.name) === false) return { ok: false, message: `It stopped, but did not start here. ${resumeHint}` };
    if (fileHere && keep.mode) noteMode(fileHere.sessionId, keep.mode);
    // A VS Code tab's name stays with the tab, so it comes along as a name saved here.
    if (pidHere && (s.nameSource === "tab" || s.nameSource === "saved")) {
      const moved = (await readSessionFiles()).find((x) => x.pid === pidHere);
      if (moved && (s.nameSource === "tab" || moved.sessionId !== s.sessionId)) await saveName(moved.sessionId, s.name).catch(() => {});
    }
    await monitor.fresh();
    return pidHere
      ? { ok: true, message: "Moved to Control Room. Its old terminal tab can be closed.", pid: pidHere, name: r.name }
      : { ok: true, message: "Moved. It shows up here as soon as Claude Code is ready.", name: r.name };
  } finally {
    moving.delete(pid);
  }
}

/** A link from a session or an account opens in the Chrome profile signed in to that account's email, as its sessions' do. */
export async function openUrl(url: string, email: string | null = null): Promise<ActionResult> {
  // Web pages only: http too, for a dev server on this Mac. `open` would also run file: and app links.
  if (typeof url !== "string" || !/^https?:\/\/[^\s]+$/i.test(url)) return { ok: false, message: "Only web links open from here." };
  const profile = email ? profileOf(await chromeProfiles(), email) : null;
  if (profile && (await run("open", chromeArgs(profile, url), { timeoutMs: 10_000 })).ok) return { ok: true, message: `Opened in Chrome as ${email}` };
  launch("open", [url]);
  return { ok: true, message: "Opened" };
}

export function openFolder(path: string): ActionResult {
  launch("open", [path]);
  return { ok: true, message: "Opened in Finder" };
}

/** A new terminal in Control Room, in the folder from Settings. It shows as a tile once it runs, which is at once. */
export async function startTerminal(monitor: Monitor): Promise<ActionResult & { pid?: number }> {
  const folder = folderSetting(settings().terminalFolder);
  if (!folder) return { ok: false, message: `That folder is gone: ${settings().terminalFolder}. Pick another in Settings.` };
  const r = await startShell(folder);
  if (!r.ok || !r.name) return r;
  await monitor.fresh();
  const s = monitor.snapshot?.sessions.find((x) => x.sessionId === r.name);
  return s ? { ok: true, message: "Opened a terminal", pid: s.pid } : { ok: false, message: "The terminal closed right after it started." };
}

export async function worktreeReportFor(monitor: Monitor, s: Session): Promise<WorktreeReport | null> {
  // Only the worktree it started in: one it went on to work in (`cd ../shield-27336`) may hold others' work too.
  if (!s.git || !s.git.isWorktree || !insidePath(s.cwd, s.git.root)) return null;
  const entries = await listWorktrees(s.git.mainRoot);
  const entry = entries.find((e) => e.path === s.git?.root);
  if (!entry) return null;
  const slug = s.git.remote ? `${s.git.remote.owner}/${s.git.remote.name}` : null;
  const prs = new Map<string, PrRow>();
  const pr = slug && entry.branch ? prForBranch(slug, entry.branch) : null;
  if (pr && entry.branch) prs.set(entry.branch, pr);
  const reg = await repoClaims(s.git.mainRoot, monitor.isLiveClaude);
  const others = (path: string) =>
    (monitor.snapshot?.sessions ?? []).filter((o) => o.pid !== s.pid && worksIn(o, path)).map((o) => o.pid);
  return buildReport(s.git.mainRoot, entry, {
    prs,
    livePids: others,
    claim: (path) => {
      const c = reg?.claims.find((x) => x.worktree === path);
      return c ? { live: c.live, note: c.note } : null;
    },
  });
}

export async function closePlan(monitor: Monitor, pid: number): Promise<ClosePlan | null> {
  const s = find(monitor, pid);
  if (!s) return null;
  return { pid, claims: s.claims, worktree: await worktreeReportFor(monitor, s) };
}

async function stopProcess(pid: number): Promise<boolean> {
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return !alive();
  }
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    if (!alive()) return true;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  await sleep(300);
  return !alive();
}

export async function closeSession(monitor: Monitor, pid: number, req: CloseRequest): Promise<ActionResult> {
  const s = find(monitor, pid);
  if (!s) return { ok: false, message: "That session is gone." };
  if (!req.close) return { ok: false, message: "Nothing to do." };
  // Stopping its process from here would cut the app off from it; the app closes its own sessions.
  if (s.desktopUrl) return { ok: false, message: `${IN_DESKTOP} Close or archive it there.` };
  // A terminal ends with its tmux session, and whatever runs in it with it.
  if (s.terminal) {
    if (!(await stopConsole(s.sessionId))) return { ok: false, message: "The terminal did not close." };
    await monitor.tick();
    return { ok: true, message: "Terminal closed" };
  }
  const log: string[] = [];
  const report = req.deleteWorktree ? await worktreeReportFor(monitor, s) : null;
  if (req.deleteWorktree) {
    if (!report) return { ok: false, message: "This session is not in a worktree that can be deleted." };
    if (report.verdict === "in-use" || report.verdict === "main") return { ok: false, message: report.reason };
    if (report.verdict === "keep" && !req.force) return { ok: false, message: `Not deleted: ${report.reason}` };
  }

  const stopped = await stopProcess(pid);
  log.push(stopped ? "Stopped Claude." : "Claude did not stop.");
  if (!stopped) return { ok: false, message: "Claude did not stop, so nothing else was changed.", log };
  // closeTerminal checks the helper itself, so it also says when an unlinked tab stays open.
  if (s.ide === "vscode" || s.vscodeLinked) {
    const closed = await closeTerminal(s.shellPid);
    log.push(closed.ok ? "Closed its VS Code terminal." : closed.message);
  }

  const reg = s.git ? await repoClaims(s.git.mainRoot, monitor.isLiveClaude) : null;
  const worktree = s.git?.isWorktree && insidePath(s.cwd, s.git.root) ? s.git.root : null;
  const held = new Set(s.claims.map((c) => c.worktree));
  if (reg) {
    for (const w of held) {
      const remove = req.deleteWorktree && w === worktree;
      // A merged PR whose head is this HEAD has every commit, so the script's own unpushed check may be overruled.
      const force = remove && (req.force || (report !== null && report.verdict === "safe"));
      const out = await endClaim(reg, w, { remove, force });
      log.push(out.output || (out.ok ? `Released ${w}` : `Could not release ${w}`));
      if (remove && !out.ok) return { ok: false, message: "The session stopped, but the worktree was not deleted.", log };
    }
  }
  if (req.deleteWorktree && worktree && !held.has(worktree)) {
    let out;
    if (reg?.script) {
      const force = req.force || report?.verdict === "safe";
      out = await endClaim(reg, worktree, { remove: true, force });
      log.push(out.output);
    } else {
      const args = ["worktree", "remove", ...(req.force ? ["--force"] : []), worktree];
      const r = await git(s.git!.mainRoot, args, 60_000);
      out = { ok: r.ok, output: (r.stdout + r.stderr).trim() };
      log.push(out.ok ? `Deleted ${worktree}` : out.output);
    }
    if (!out.ok) return { ok: false, message: "The session stopped, but the worktree was not deleted.", log };
  }
  if (s.git) forgetClaims(s.git.mainRoot);
  await monitor.tick();
  const parts = ["Session closed"];
  if (held.size) parts.push(`${held.size} claim${held.size === 1 ? "" : "s"} released`);
  if (req.deleteWorktree) parts.push("worktree deleted");
  return { ok: true, message: parts.join(" · "), log };
}

/** Deletes worktrees, each one re-checked right before: a scan can be minutes old. */
export async function removeWorktrees(
  mainRoot: string,
  paths: string[],
  isLiveClaude: (pid: number) => boolean,
  freshReport: (path: string) => Promise<WorktreeReport | null>,
  onDone: (path: string) => void,
): Promise<ActionResult> {
  const reg = await repoClaims(mainRoot, isLiveClaude);
  const log: string[] = [];
  let removed = 0;
  for (const path of paths) {
    const report = path === mainRoot ? null : await freshReport(path);
    if (!report || (report.verdict !== "safe" && report.verdict !== "probably-safe")) {
      log.push(`Kept ${path}: ${report?.reason ?? "not a removable worktree"}`);
      continue;
    }
    // "safe" means a merged PR holds every commit, so the script's own unpushed check may be overruled.
    const force = report.verdict === "safe";
    const out = reg?.script
      ? await endClaim(reg, path, { remove: true, force })
      : await git(mainRoot, ["worktree", "remove", ...(force ? ["--force"] : []), path], 60_000).then((r) => ({
          ok: r.ok,
          output: (r.stdout + r.stderr).trim(),
        }));
    if (out.ok) {
      removed++;
      onDone(path);
    }
    log.push(out.ok ? `Deleted ${path}` : `Failed ${path}: ${out.output.split("\n").pop()}`);
  }
  return { ok: removed === paths.length, message: `Deleted ${removed} of ${paths.length} worktrees`, log };
}

export async function pruneWorktrees(mainRoot: string): Promise<ActionResult> {
  const r = await git(mainRoot, ["worktree", "prune"], 60_000);
  return { ok: r.ok, message: r.ok ? "Pruned worktree entries whose folders are gone" : r.stderr.trim() };
}
