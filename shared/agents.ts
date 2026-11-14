// Coding agents besides Claude Code that New session can start: built in, or your own command from Settings.
// Control Room runs each in its own console and reads its state off its screen; of their files, it reads only Codex's
// limits.
import type { AgentWindow } from "./types.ts";

export interface AgentTool {
  id: string; // "codex", or "x-1a2b3c4d" for one of yours
  label: string;
  bin: string; // the program it runs, to tell whether it is installed
  command: string; // for the shell; "$@" is where the first message goes, as one argument
  takesPrompt: boolean; // false: it starts empty, and you type the first message in its console
}

export interface CustomAgent {
  id: string;
  label: string;
  command: string; // as you would type it; {prompt} is where the first message goes
}

export const BUILT_IN_AGENTS: AgentTool[] = [
  { id: "codex", label: "Codex", bin: "codex", command: 'codex "$@"', takesPrompt: true },
  { id: "gemini", label: "Gemini", bin: "gemini", command: 'gemini "$@"', takesPrompt: true },
  { id: "cursor", label: "Cursor Agent", bin: "cursor-agent", command: 'cursor-agent "$@"', takesPrompt: true },
  { id: "kimi", label: "Kimi Code", bin: "kimi", command: "kimi", takesPrompt: false },
  // Ollama's own menu: pick a coding tool and a local or cloud model. Its server runs for as long as this console does
  // when none runs already; the shell stops it on the way out.
  {
    id: "ollama",
    label: "Ollama",
    bin: "ollama",
    command: 'ollama ps >/dev/null 2>&1 || { echo "Starting Ollama for this console"; ollama serve >/dev/null 2>&1 & sleep 2; }; ollama launch',
    takesPrompt: false,
  },
];

/**
 * Pure: what the shell runs for an agent. One that fails keeps its console open until you press Enter, so you can read
 * why; quitting it, with Ctrl+C too, closes the console.
 */
export function agentScript(command: string): string {
  return `${command}\ns=$?\nif [ $s -ne 0 ] && [ $s -ne 130 ]; then printf '\\n[It exited with %s. Press Enter to close.]' $s; read -r line; fi`;
}

export const MAX_AGENTS = 12;

/** Pure: the first message as an agent's argument. One that starts with "-" would be read as an option. */
export function promptArg(prompt: string): string {
  return prompt.startsWith("-") ? ` ${prompt}` : prompt;
}

/** Pure: one of your agents as the shell runs it. {prompt} becomes "$1", so the message is never read as shell code. */
export function customTool(a: CustomAgent): AgentTool {
  const bin = a.command.trim().split(/\s+/)[0] ?? "";
  return { id: a.id, label: a.label, bin, command: a.command.replaceAll("{prompt}", '"$1"'), takesPrompt: a.command.includes("{prompt}") };
}

export function allAgents(custom: CustomAgent[]): AgentTool[] {
  return [...BUILT_IN_AGENTS, ...custom.map(customTool)];
}

/** Pure: your agents from a file: each with a name, a command and an id of its own. */
export function cleanAgents(raw: unknown): CustomAgent[] {
  const out: CustomAgent[] = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    const id = typeof a?.id === "string" && /^x-[0-9a-f]{8}$/.test(a.id) ? a.id : null;
    const label = agentLabel(a?.label);
    const command = agentCommand(a?.command);
    if (id && label && command && out.length < MAX_AGENTS && !out.some((o) => o.id === id)) out.push({ id, label, command });
  }
  return out;
}

/** Pure: the list with one of your agents added; an error message when it can't be. */
export function withAgent(list: CustomAgent[], input: { label?: unknown; command?: unknown }, newId: () => string): { agents: CustomAgent[] } | { error: string } {
  const label = agentLabel(input.label);
  const command = agentCommand(input.command);
  if (!label || !command) return { error: "An agent needs a name and a command." };
  if (list.length >= MAX_AGENTS) return { error: `You can add up to ${MAX_AGENTS} agents.` };
  if ([...BUILT_IN_AGENTS, ...list].some((a) => a.label.toLowerCase() === label.toLowerCase())) return { error: `There is an agent called ${label} already.` };
  return { agents: [...list, { id: `x-${newId()}`, label, command }] };
}

export function agentLabel(raw: unknown): string | null {
  const label = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 30) : "";
  return label || null;
}

/** One line, as typed; the shell reads it, the same as in a terminal tab. */
export function agentCommand(raw: unknown): string | null {
  const command = typeof raw === "string" ? raw.replace(/[\r\n]+/g, " ").trim().slice(0, 400) : "";
  return command || null;
}

/**
 * Pure: where an agent is by its screen. Moving is working. Still after working may be done, or may be asking to run
 * something: the screen can't tell, so it only says it stopped.
 */
export function agentActivity(
  changedAt: number,
  worked: boolean,
  now: number,
  inactiveAfterMs: number,
): { kind: "working" | "idle" | "inactive"; label: string } {
  if (now - changedAt < 4_000) return { kind: "working", label: "Working" };
  if (now - changedAt > inactiveAfterMs) return { kind: "inactive", label: "Inactive" };
  return worked ? { kind: "idle", label: "Stopped · check it" } : { kind: "idle", label: "Ready" };
}

/** Pure: a limit window's name by its length. Codex's first window is the 5-hour one on some plans and the week on others. */
export function windowLabel(minutes: number): string {
  if (minutes === 300) return "5-hour";
  if (minutes === 10_080) return "Week";
  if (minutes % 1_440 === 0) return `${minutes / 1_440}-day`;
  return `${Math.round(minutes / 60)}-hour`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Pure: Codex's limits from the end of one of its session files: each reply's token_count event carries them. The
 * newest one wins; null when no line has them, such as a session with no reply yet. Windows that reset are kept here.
 */
export function codexLimits(text: string): { plan: string | null; windows: AgentWindow[] } | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    let event: { timestamp?: unknown; payload?: { type?: unknown; rate_limits?: Record<string, unknown> | null } };
    try {
      event = JSON.parse(lines[i]);
    } catch {
      continue; // the tail's first line is cut
    }
    const limits = event?.payload?.type === "token_count" ? event.payload.rate_limits : null;
    if (!limits || typeof limits !== "object") continue;
    const at = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
    const windows = [limits.primary, limits.secondary]
      .map((w) => codexWindow(w, at))
      .filter((w): w is AgentWindow => w !== null)
      .sort((a, b) => a.minutes - b.minutes);
    const plan = typeof limits.plan_type === "string" && limits.plan_type ? limits.plan_type[0].toUpperCase() + limits.plan_type.slice(1) : null;
    return { plan, windows };
  }
  return null;
}

/** Newer Codex says when a window resets (epoch seconds); older Codex said in how long, from the event's time. */
function codexWindow(raw: unknown, at: number): AgentWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const used = num(w.used_percent);
  const minutes = num(w.window_minutes);
  const resetsAt = num(w.resets_at) !== null ? num(w.resets_at)! * 1000 : num(w.resets_in_seconds) !== null && !Number.isNaN(at) ? at + num(w.resets_in_seconds)! * 1000 : null;
  if (used === null || minutes === null || minutes <= 0 || resetsAt === null) return null;
  return { label: windowLabel(minutes), minutes, usedPercent: Math.min(100, Math.max(0, used)), resetsAt };
}
