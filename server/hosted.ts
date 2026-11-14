// Sessions that run inside Control Room: each is a tmux session on Control Room's own tmux server, so it keeps
// running when the app quits, and the app's console can show it and type into it.
import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { isEffort, isMode, isModel } from "../shared/claude.ts";
import { type AgentTool, agentScript, promptArg } from "../shared/agents.ts";
import { isHostedName } from "../shared/hosted.ts";
import type { AccountRef, ActionResult } from "../shared/types.ts";
import { APP_DIR } from "./paths.ts";
import { CHILD_ENV, run } from "./proc.ts";

// A socket of its own: the person's own tmux, its config and its sessions stay untouched.
export const SOCKET = process.env.CONTROL_ROOM_TMUX_SOCKET ?? "control-room";
const CONF = join(APP_DIR, "tmux.conf");
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// screen-256color is known to every Mac; tmux answers the terminal queries itself, so the console never has to.
const CONF_TEXT = `# Written by Control Room for its own tmux server (tmux -L ${SOCKET}). Changes are overwritten.
set -g default-terminal "screen-256color"
set -g history-limit 20000
set -g status off
set -g escape-time 0
set -g window-size latest
set -g extended-keys off
set -g focus-events on
`;

const TMUX_PATHS = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"];

export function tmuxReady(): boolean {
  return TMUX_PATHS.some((p) => existsSync(p));
}

/** Arguments for Control Room's tmux server. */
export function tmuxArgs(...args: string[]): string[] {
  return ["-L", SOCKET, ...args];
}

export { hostedName, isAgentName, isHostedName, isTerminalName } from "../shared/hosted.ts";

// The variables of whoever started Control Room (Electron, npm, or a Claude Code session) must not reach a new
// session: a Claude Code that sees CLAUDECODE thinks it runs inside another one, and one that inherits
// CLAUDE_CONFIG_DIR runs on whatever account that names.
const FOREIGN = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_.*|CLAUDE_CONFIG_DIR|CLAUDE_PID|CLAUDE_EFFORT|AI_AGENT|ELECTRON_.*|npm_.*|NODE_OPTIONS|INIT_CWD|VSCODE_.*|TERM_PROGRAM.*|TMUX|TMUX_PANE|COLUMNS|LINES)$/;

// Nor the editor a Claude Code tool runs with: EDITOR=vi gives zsh its vi keys, where ⌃R searches no history, and
// GIT_EDITOR=true makes git commit skip the message. Only when they came from one: an editor of your own stays.
const TOOL_EDITOR = /^(EDITOR|VISUAL|GIT_EDITOR)$/;
const fromClaudeTool = (env: NodeJS.ProcessEnv) => env.CLAUDECODE !== undefined || env.GIT_EDITOR === "true" || /^claude-code/.test(env.AI_AGENT ?? "");

const unwanted = (env: NodeJS.ProcessEnv) => {
  const tool = fromClaudeTool(env);
  return (name: string) => FOREIGN.test(name) || (tool && TOOL_EDITOR.test(name));
};

export function sessionEnv(base: NodeJS.ProcessEnv = CHILD_ENV): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const drop = unwanted(base);
  for (const [k, v] of Object.entries(base)) if (!drop(k)) env[k] = v;
  env.COLORTERM = "truecolor";
  env.LANG ??= "en_US.UTF-8";
  return env;
}

/** Runs a command on Control Room's tmux server, with the clean environment it was started with. */
export function tmux(args: string[], timeoutMs = 5_000) {
  return run("tmux", tmuxArgs(...args), { timeoutMs, env: sessionEnv() });
}

export interface HostedPane {
  name: string; // its tmux session
  createdAt: number; // epoch ms
  pid: number; // what the pane runs: Claude Code's shell, or a terminal's shell
  cwd: string; // the folder that program is in now
  command: string; // the program in front, such as "zsh" or "npm"
  agent: string; // the coding agent it was started with, such as "codex"; "" for the rest
  prompt: string; // the first message it was started with, if any
}

/** The sessions that run on Control Room's tmux server now, one pane each; null when tmux could not say. */
export async function hostedPanes(): Promise<HostedPane[] | null> {
  if (!tmuxReady()) return [];
  const format = "#{session_name}\t#{session_created}\t#{pane_pid}\t#{pane_current_path}\t#{pane_current_command}\t#{@cr_agent}\t#{@cr_prompt}";
  const out = await tmux(["list-panes", "-a", "-F", format], 2_000);
  // No server means nothing runs here; any other failure says nothing either way.
  if (!out.ok) return /no server running|error connecting/i.test(out.stderr) ? [] : null;
  const panes = new Map<string, HostedPane>();
  for (const line of out.stdout.split("\n")) {
    const [name, created, pid, cwd, command, agent, ...prompt] = line.split("\t");
    if (!isHostedName(name) || panes.has(name)) continue;
    panes.set(name, { name, createdAt: Number(created) * 1000, pid: Number(pid), cwd: cwd ?? "", command: command ?? "", agent: agent ?? "", prompt: prompt.join("\t") });
  }
  return [...panes.values()];
}

/** Names of the sessions that run on Control Room's tmux server now; null when tmux could not say. */
export async function hostedSessions(): Promise<Set<string> | null> {
  const panes = await hostedPanes();
  return panes && new Set(panes.map((p) => p.name));
}

/** The last lines on a hosted session's screen, as plain text, without the empty rows under the prompt. */
export async function screenLines(name: string, keep: number): Promise<string[]> {
  const out = await tmux(["capture-pane", "-p", "-t", `=${name}:`], 2_000);
  if (!out.ok) return [];
  const lines = out.stdout.split("\n").map((l) => l.trimEnd());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.slice(-keep).map((l) => l.slice(0, 300));
}

export interface StartOptions {
  cwd: string;
  prompt?: string | null;
  resume?: string | null; // a session id to continue
  model?: string | null; // an alias such as "opus", or a full model name
  effort?: string | null;
  mode?: string | null; // permission mode
  account?: AccountRef | null; // another Claude account: its config folder; the usual one when left out
  cols?: number;
  rows?: number;
}

/**
 * The arguments for `tmux new-session`. An interactive login shell runs `claude` the way a terminal tab does: with the
 * same PATH and variables, and with a `claude` function from ~/.zshrc when there is one.
 */
export function newSessionArgs(name: string, o: StartOptions, shell = process.env.SHELL || "/bin/zsh"): string[] {
  // "--" ends Claude Code's own options, so a message that starts with "-" stays a message.
  const claude = [
    ...(o.model ? ["--model", o.model] : []),
    ...(o.effort ? ["--effort", o.effort] : []),
    ...(o.mode ? ["--permission-mode", o.mode] : []),
    ...(o.resume ? ["--resume", o.resume] : o.prompt ? ["--", o.prompt] : []),
  ];
  const cols = String(Math.max(40, Math.min(400, Math.round(o.cols ?? 120))));
  const rows = String(Math.max(10, Math.min(200, Math.round(o.rows ?? 36))));
  // Another account: Claude Code finds its login, settings and sessions in the folder CLAUDE_CONFIG_DIR names. It is
  // set after the shell has read ~/.zshrc, so nothing there points the session elsewhere.
  const command = o.account ? 'export CLAUDE_CONFIG_DIR="$1"; shift; claude "$@"' : 'claude "$@"';
  // "$@" hands the prompt over as one argument, so nothing in it is read by the shell.
  return ["-f", CONF, "-u", "new-session", "-d", "-s", name, "-c", o.cwd, "-x", cols, "-y", rows, shell, "-lic", command, "claude", ...(o.account ? [o.account.dir] : []), ...claude];
}

async function writeConf(): Promise<void> {
  const current = await readFile(CONF, "utf8").catch(() => null);
  if (current !== CONF_TEXT) await writeFile(CONF, CONF_TEXT);
  await cleanServerEnv();
}

/** Pure: the variables in `tmux show-environment` output that a new session must not get. */
export function foreignNames(listing: string): string[] {
  const env: NodeJS.ProcessEnv = {};
  for (const line of listing.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1); // "-NAME" lines are unset already
  }
  return Object.keys(env).filter(unwanted(env));
}

/**
 * A tmux server keeps the variables it started with and gives them to every session after. One started before a
 * variable joined FOREIGN still has it, so it is taken out of the server too; no server yet is nothing to clean.
 */
async function cleanServerEnv(): Promise<void> {
  const out = await tmux(["show-environment", "-g"], 2_000);
  if (!out.ok) return;
  for (const name of foreignNames(out.stdout)) await tmux(["set-environment", "-g", "-u", name], 2_000);
}

/**
 * How a terminal starts your shell. zsh writes its history only when it exits, and a terminal here can run for days:
 * shared, each command goes to ~/.zsh_history as it runs and the other terminals find it with ⌃R. A setopt in
 * ~/.zshrc still has the last word.
 */
export function shellArgs(shell: string): string[] {
  return basename(shell) === "zsh" ? [shell, "-l", "-o", "SHARE_HISTORY"] : [shell, "-l"];
}

/** Starts a terminal: your shell in a new tmux session, the way a Terminal window starts it. */
export async function startShell(cwd: string, shell = process.env.SHELL || "/bin/zsh"): Promise<ActionResult & { name?: string }> {
  if (!tmuxReady()) return { ok: false, message: "Control Room needs tmux for this. Install it: brew install tmux" };
  await writeConf();
  const name = `crt-${randomBytes(4).toString("hex")}`;
  const started = await tmux(["-f", CONF, "-u", "new-session", "-d", "-s", name, "-c", cwd, "-x", "120", "-y", "36", ...shellArgs(shell)], 10_000);
  if (!started.ok) return { ok: false, message: (started.stderr || started.stdout).trim() || "tmux did not start the terminal." };
  return { ok: true, message: "Started", name };
}

/**
 * Starts another coding agent, such as Codex, in a new tmux session: your login shell runs it, so it is found where
 * your terminal finds it. The first message goes over as one argument, never read by the shell. Which agent it is,
 * and that message, stay on the session for its tile.
 */
export async function startAgent(cwd: string, tool: AgentTool, prompt: string | null, shell = process.env.SHELL || "/bin/zsh"): Promise<ActionResult & { name?: string }> {
  if (!tmuxReady()) return { ok: false, message: "Control Room needs tmux for this. Install it: brew install tmux" };
  if (typeof cwd !== "string" || !isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) return { ok: false, message: "Pick a folder that exists." };
  await writeConf();
  const name = `cra-${randomBytes(4).toString("hex")}`;
  const args = tool.takesPrompt && prompt ? [promptArg(prompt)] : [];
  const started = await tmux(["-f", CONF, "-u", "new-session", "-d", "-s", name, "-c", cwd, "-x", "120", "-y", "36", shell, "-lic", agentScript(tool.command), tool.bin, ...args], 10_000);
  if (!started.ok) return { ok: false, message: (started.stderr || started.stdout).trim() || `tmux did not start ${tool.label}.` };
  await tmux(["set-option", "-t", name, "@cr_agent", tool.id], 2_000);
  if (prompt) await tmux(["set-option", "-t", name, "@cr_prompt", prompt.replace(/[\t\n\r]+/g, " ").slice(0, 2_000)], 2_000);
  return { ok: true, message: "Started", name };
}

/** Starts Claude Code in a new tmux session. Claude Code writes its session file a moment later, or once the folder is trusted. */
export async function startSession(o: StartOptions): Promise<ActionResult & { name?: string }> {
  if (!tmuxReady()) return { ok: false, message: "Control Room needs tmux for this. Install it: brew install tmux" };
  if (typeof o.cwd !== "string" || !isAbsolute(o.cwd) || !existsSync(o.cwd) || !statSync(o.cwd).isDirectory()) {
    return { ok: false, message: "Pick a folder that exists." };
  }
  if (o.prompt !== undefined && o.prompt !== null && typeof o.prompt !== "string") return { ok: false, message: "The first message must be text." };
  if (o.resume && !SESSION_ID.test(o.resume)) return { ok: false, message: "That is not a Claude Code session id." };
  if (o.model && !isModel(o.model)) return { ok: false, message: "That is not a model name." };
  if (o.effort && !isEffort(o.effort)) return { ok: false, message: "That is not an effort level." };
  if (o.mode && !isMode(o.mode)) return { ok: false, message: "That is not a permission mode." };
  await writeConf();
  const name = `cr-${randomBytes(4).toString("hex")}`;
  const started = await tmux(newSessionArgs(name, o), 10_000);
  if (!started.ok) return { ok: false, message: (started.stderr || started.stdout).trim() || "tmux did not start the session." };
  return { ok: true, message: "Started", name };
}
