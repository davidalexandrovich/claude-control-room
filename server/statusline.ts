import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RateWindow, SetupState, Usage } from "../shared/types.ts";
import { linkScript } from "./chrome.ts";
import { type Home, homeOf, homes, settingsFile } from "./homes.ts";
import { APP_DIR, BACKUP_DIR, CLAUDE_DIR, HOOK_DIR, HOOK_SCRIPT, TAP_DIR, TAP_SCRIPT } from "./paths.ts";

// Claude Code runs this on every reply; it saves the JSON it receives and prints a short status line.
// A status line the person already had is kept: it still runs and its output is what they see.
export function tapScript(wrapped: string | null): string {
  const line = wrapped
    ? `printf '%s' "$input" | ${wrapped}`
    : `printf '%s' "$input" | /usr/bin/jq -r '
  def pct(p): if p == null then empty else (p | floor | tostring) + "%" end;
  [ (.model.display_name // empty),
    (.effort.level // empty),
    (if .context_window.used_percentage != null then "context " + pct(.context_window.used_percentage) else empty end),
    (if .rate_limits.five_hour.used_percentage != null then "5h " + pct(.rate_limits.five_hour.used_percentage) else empty end),
    (if .rate_limits.seven_day.used_percentage != null then "week " + pct(.rate_limits.seven_day.used_percentage) else empty end)
  ] | join(" · ")' 2>/dev/null`;
  return `#!/bin/sh
# Control Room status line tap (installed by the Control Room app; remove it from the app's Setup panel).
input=$(cat)
dir="$HOME/.claude-control-room/statusline"
mkdir -p "$dir"
sid=$(printf '%s' "$input" | /usr/bin/jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$sid" ]; then
  printf '%s' "$input" > "$dir/$sid.json.tmp" && mv "$dir/$sid.json.tmp" "$dir/$sid.json"
fi
${line}
`;
}

interface HookEntry {
  matcher?: string;
  hooks?: { type?: string; command?: string; async?: boolean; timeout?: number }[];
}

interface ClaudeSettings {
  statusLine?: { type?: string; command?: string; padding?: number; refreshInterval?: number };
  hooks?: Record<string, HookEntry[]>;
  env?: Record<string, string>;
  effortLevel?: string;
  [key: string]: unknown;
}

// Runs in the background on every permission prompt (async, so it never delays one) and saves
// what the prompt asks, because the transcript only records a tool call once it is approved.
export const HOOK_BODY = `#!/bin/sh
# Control Room permission hook (installed by the Control Room app; remove it from the app's Settings).
input=$(cat)
dir="$HOME/.claude-control-room/permissions"
mkdir -p "$dir"
sid=$(printf '%s' "$input" | /usr/bin/jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$sid" ]; then
  printf '%s' "$input" > "$dir/$sid.json.tmp" && mv "$dir/$sid.json.tmp" "$dir/$sid.json"
fi
exit 0
`;

const HOOK_EVENT = "PermissionRequest";

// Each account has its own settings.json, in its config folder: ~/.claude for the usual one.
async function readSettings(dir = CLAUDE_DIR): Promise<ClaudeSettings> {
  return JSON.parse(await readFile(settingsFile(dir), "utf8")) as ClaudeSettings;
}

/** An account that never saved a setting has no settings.json yet; a file that does not parse still stops a write. */
async function readSettingsOrNone(dir: string): Promise<ClaudeSettings> {
  return readSettings(dir).catch((err: NodeJS.ErrnoException) => (err.code === "ENOENT" ? {} : Promise.reject(err)));
}

async function writeSettings(next: ClaudeSettings, dir = CLAUDE_DIR): Promise<void> {
  const file = settingsFile(dir);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.control-room.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n");
  await rename(tmp, file);
}

const DEFAULT_KEYS = ["model", "modelSettings", "effortLevel"] as const;

/**
 * Claude Code's /model and /effort also save the choice as the default for new sessions. A change made from
 * Control Room is for one session only, so this puts the saved defaults back once `change` is done: in the settings of
 * the session's own account.
 */
export async function keepDefaults<T>(change: () => Promise<T>, dir = CLAUDE_DIR): Promise<T> {
  // An account that never saved a setting has no file yet: whatever /model writes there is taken out again.
  const before = await readSettingsOrNone(dir).catch(() => null);
  try {
    return await change();
  } finally {
    if (before) await restoreDefaults(before, dir).catch(() => {});
  }
}

async function restoreDefaults(before: Record<string, unknown>, dir: string): Promise<void> {
  const now: Record<string, unknown> = await readSettings(dir);
  let changed = false;
  for (const key of DEFAULT_KEYS) {
    if (JSON.stringify(now[key]) === JSON.stringify(before[key])) continue;
    if (before[key] === undefined) delete now[key];
    else now[key] = before[key];
    changed = true;
  }
  if (changed) await writeSettings(now, dir);
}

// The usual account's files keep their old names; another account's carry a short id of its folder.
function homeId(h: Home): string {
  return createHash("sha256").update(h.dir).digest("hex").slice(0, 10);
}

function backupName(h: Home, name: string): string {
  return h.account ? name.replace(/^([^.]+)/, `$1-${homeId(h)}`) : name;
}

/** Each account has its own script, so the status line it had keeps showing in it. */
function tapPath(h: Home): string {
  return h.account ? join(APP_DIR, `statusline-tap-${homeId(h)}.sh`) : TAP_SCRIPT;
}

/** The script an account's sessions open links with, as $BROWSER: one per account, for its own Chrome profile. */
function linkPathOf(dir: string): string {
  return join(APP_DIR, dir === CLAUDE_DIR ? "open-link.sh" : `open-link-${createHash("sha256").update(dir).digest("hex").slice(0, 10)}.sh`);
}

export const linkPath = (h: Home) => linkPathOf(h.dir);

function isLinkScript(command: string | undefined): boolean {
  return !!command?.startsWith(join(APP_DIR, "open-link"));
}

/**
 * The account's links go through its own script. A $BROWSER the person set themselves is theirs to keep; another
 * account's script (a settings.json copied over from it) is not this one's, and Connect points it here.
 */
function linksReady(settings: ClaudeSettings, dir: string): boolean {
  const browser = settings.env?.BROWSER;
  return !!browser && (!isLinkScript(browser) || browser === linkPathOf(dir));
}

/** Writes the account's link script when it differs, so sessions that run already open the next link the new way. */
export async function writeLinkScript(h: Home, profile: string | null): Promise<void> {
  const file = linkPath(h);
  const body = linkScript(profile);
  if ((await readFile(file, "utf8").catch(() => null)) === body) return;
  await mkdir(APP_DIR, { recursive: true });
  // A session may run it this very moment: it gets the old script or the new one whole, never half of one.
  const tmp = `${file}.tmp`;
  await writeFile(tmp, body, { mode: 0o755 });
  await chmod(tmp, 0o755);
  await rename(tmp, file);
}

/** Control Room's status line, whichever account's script it runs. */
function isTap(command: string | undefined): boolean {
  return !!command?.includes(join(APP_DIR, "statusline-tap"));
}

async function backupSettings(h: Home): Promise<string | null> {
  await mkdir(BACKUP_DIR, { recursive: true });
  const target = join(BACKUP_DIR, backupName(h, `settings.${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  try {
    await copyFile(settingsFile(h.dir), target);
    return target;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null; // nothing to back up yet
    throw err;
  }
}

function isOurs(entry: HookEntry): boolean {
  return (entry.hooks ?? []).some((h) => h.command === HOOK_SCRIPT);
}

export function hookInstalled(settings: ClaudeSettings): boolean {
  return (settings.hooks?.[HOOK_EVENT] ?? []).some(isOurs);
}

/** Pure: the settings with our status line, hook and link opener added. Kept separate so the merge is tested alone. */
export function withConnection(settings: ClaudeSettings, tap = TAP_SCRIPT, link = join(APP_DIR, "open-link.sh")): ClaudeSettings {
  const next: ClaudeSettings = { ...settings, statusLine: { type: "command", command: tap, padding: 0 } };
  if (!settings.env?.BROWSER || isLinkScript(settings.env.BROWSER)) next.env = { ...settings.env, BROWSER: link };
  const hooks = { ...(settings.hooks ?? {}) };
  hooks[HOOK_EVENT] = [
    ...(hooks[HOOK_EVENT] ?? []).filter((e) => !isOurs(e)),
    { matcher: "*", hooks: [{ type: "command", command: HOOK_SCRIPT, async: true, timeout: 5 }] },
  ];
  next.hooks = hooks;
  return next;
}

/** Pure: the settings with our status line, hook and link opener taken out, and the person's own status line back. */
export function withoutConnection(settings: ClaudeSettings, original: ClaudeSettings["statusLine"] | null): ClaudeSettings {
  const next: ClaudeSettings = { ...settings };
  if (isTap(next.statusLine?.command)) {
    if (original) next.statusLine = original;
    else delete next.statusLine;
  }
  if (next.hooks) {
    const hooks = { ...next.hooks };
    const kept = (hooks[HOOK_EVENT] ?? []).filter((e) => !isOurs(e));
    if (kept.length) hooks[HOOK_EVENT] = kept;
    else delete hooks[HOOK_EVENT];
    if (Object.keys(hooks).length) next.hooks = hooks;
    else delete next.hooks;
  }
  if (isLinkScript(next.env?.BROWSER)) {
    const { BROWSER: _, ...env } = next.env!;
    if (Object.keys(env).length) next.env = env;
    else delete next.env;
  }
  return next;
}

export async function statusLineState(dir = CLAUDE_DIR): Promise<{ statusLine: SetupState["statusLine"]; hooks: boolean; links: boolean }> {
  try {
    const s = await readSettings(dir);
    const cmd = s.statusLine?.command ?? null;
    return { statusLine: !cmd ? "missing" : isTap(cmd) ? "installed" : "foreign", hooks: hookInstalled(s), links: linksReady(s, dir) };
  } catch {
    return { statusLine: "missing", hooks: false, links: false };
  }
}

/** The person's default effort level from the account's settings.json, used until a session reports its own. */
export async function defaultEffort(dir = CLAUDE_DIR): Promise<string | null> {
  try {
    const s = await readSettings(dir);
    return process.env.CLAUDE_CODE_EFFORT_LEVEL ?? (typeof s.effortLevel === "string" ? s.effortLevel : null);
  } catch {
    return null;
  }
}

/** Adds the status line, the permission hook and the link opener to one account's settings.json, after a backup. */
async function connectHome(h: Home): Promise<{ changed: boolean; backup: string | null }> {
  const before = await readSettingsOrNone(h.dir);
  const current = before.statusLine?.command ?? null;
  if (isTap(current ?? undefined) && hookInstalled(before) && linksReady(before, h.dir)) return { changed: false, backup: null };
  // Plain `open` until the account's Chrome profile is known; readAccounts fills it in.
  if (!existsSync(linkPath(h))) await writeLinkScript(h, null);
  const backup = await backupSettings(h);
  if (!isTap(current ?? undefined)) {
    await writeFile(tapPath(h), tapScript(current));
    await chmod(tapPath(h), 0o755);
    await writeFile(join(BACKUP_DIR, backupName(h, "original-statusline.json")), JSON.stringify(before.statusLine ?? null) + "\n");
  }
  // Re-read right before writing so a change Claude Code just made is not lost.
  await writeSettings(withConnection(await readSettingsOrNone(h.dir), tapPath(h), linkPath(h)), h.dir);
  return { changed: true, backup };
}

/** An account added or signed in later is connected too, once the usual one is: you asked for that once already. */
export async function connectLikeUsual(h: Home): Promise<boolean> {
  const usual = await statusLineState();
  if (usual.statusLine !== "installed" || !usual.hooks) return false;
  return connectHome(h).then(
    () => true,
    () => false,
  );
}

/** Takes the status line and the hook out of one account's settings.json, and puts the status line it had back. */
export async function disconnectHome(h: Home): Promise<{ ok: boolean; message: string }> {
  try {
    const before = await readSettingsOrNone(h.dir);
    if (!isTap(before.statusLine?.command) && !hookInstalled(before) && !isLinkScript(before.env?.BROWSER)) return { ok: true, message: "Not connected" };
    await backupSettings(h);
    let original: ClaudeSettings["statusLine"] | null = null;
    try {
      original = JSON.parse(await readFile(join(BACKUP_DIR, backupName(h, "original-statusline.json")), "utf8"));
    } catch {
      original = null;
    }
    await writeSettings(withoutConnection(await readSettingsOrNone(h.dir), original), h.dir);
    return { ok: true, message: "Disconnected" };
  } catch (err) {
    return { ok: false, message: `Could not change ${settingsFile(h.dir)}: ${(err as Error).message}` };
  }
}

/** Connects every account. One whose settings.json does not parse is left alone, and the others connect still. */
export async function installStatusLine(): Promise<{ ok: boolean; message: string }> {
  await mkdir(TAP_DIR, { recursive: true });
  await writeFile(HOOK_SCRIPT, HOOK_BODY);
  await chmod(HOOK_SCRIPT, 0o755);
  let backup: string | null = null;
  let changed = false;
  const failed: string[] = [];
  for (const h of homes()) {
    try {
      const out = await connectHome(h);
      changed ||= out.changed;
      if (!h.account) backup = out.backup;
    } catch (err) {
      failed.push(`${settingsFile(h.dir)} (${(err as Error).message})`);
    }
  }
  if (failed.length) return { ok: false, message: `Could not connect ${failed.join(", ")}. Fix it and connect again.` };
  if (!changed) return { ok: true, message: "Already connected" };
  return { ok: true, message: `Connected. New sessions report everything${backup ? `; a backup of your settings is at ${backup}` : ""}` };
}

export async function uninstallStatusLine(): Promise<{ ok: boolean; message: string }> {
  const failed: string[] = [];
  for (const h of homes()) {
    const out = await disconnectHome(h);
    if (!out.ok) failed.push(out.message);
  }
  if (failed.length) return { ok: false, message: failed.join(" ") };
  return { ok: true, message: "Disconnected. Your previous status line is back." };
}

export interface Tap {
  sessionId: string;
  mtimeMs: number;
  model: string | null;
  modelId: string | null;
  effort: string | null;
  contextPercent: number | null;
  costUsd: number | null;
  cwd: string | null;
  sessionName: string | null;
  transcriptPath: string | null;
  pr: { number: number; url: string } | null;
  fiveHour: RateWindow | null;
  sevenDay: RateWindow | null;
}

const taps = new Map<string, { mtimeMs: number; tap: Tap }>();

function rate(w: any): RateWindow | null {
  if (!w || typeof w.used_percentage !== "number") return null;
  return { usedPercent: w.used_percentage, resetsAt: typeof w.resets_at === "number" ? w.resets_at * 1000 : 0 };
}

export async function readTap(sessionId: string): Promise<Tap | null> {
  const file = join(TAP_DIR, `${sessionId}.json`);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
  const hit = taps.get(sessionId);
  if (hit && hit.mtimeMs === mtimeMs) return hit.tap;
  try {
    const d = JSON.parse(await readFile(file, "utf8"));
    const tap: Tap = {
      sessionId,
      mtimeMs,
      model: d.model?.display_name ?? null,
      modelId: d.model?.id ?? null,
      effort: d.effort?.level ?? null,
      contextPercent: typeof d.context_window?.used_percentage === "number" ? d.context_window.used_percentage : null,
      costUsd: typeof d.cost?.total_cost_usd === "number" ? d.cost.total_cost_usd : null,
      cwd: d.workspace?.current_dir ?? d.cwd ?? null,
      sessionName: d.session_name ?? null,
      transcriptPath: d.transcript_path ?? null,
      pr: d.pr?.number ? { number: d.pr.number, url: d.pr.url } : null,
      fiveHour: rate(d.rate_limits?.five_hour),
      sevenDay: rate(d.rate_limits?.seven_day),
    };
    taps.set(sessionId, { mtimeMs, tap });
    return tap;
  } catch {
    return hit?.tap ?? null;
  }
}

const NO_USAGE: Usage = { fiveHour: null, sevenDay: null, observedAt: null };

/**
 * Plan usage for each account, in the order given: from whichever of its sessions reported last, since its sessions
 * share its limits. A report belongs to the account whose folder holds its conversation.
 */
export async function latestUsages(list: Home[] = homes()): Promise<Usage[]> {
  let names: string[] = [];
  try {
    names = (await readdir(TAP_DIR)).filter((n) => n.endsWith(".json"));
  } catch {
    return list.map(() => NO_USAGE);
  }
  const files: { at: number; id: string }[] = [];
  for (const n of names) {
    try {
      files.push({ at: (await stat(join(TAP_DIR, n))).mtimeMs, id: n.slice(0, -5) });
    } catch {
      /* file vanished */
    }
  }
  files.sort((a, b) => b.at - a.at);
  const now = Date.now();
  // A window whose reset time passed is stale; Claude Code drops it too.
  const live = (w: RateWindow | null) => (w && w.resetsAt > now ? w : null);
  const out = new Map<Home, Usage>();
  for (const f of files) {
    if (out.size === list.length) break;
    const tap = await readTap(f.id);
    // A session that reports no limits says nothing about the account's: one on another model, such as Ollama's, or one
    // before its first reply. The report before it still holds.
    if (!tap?.fiveHour && !tap?.sevenDay) continue;
    // A report from before Claude Code named the transcript is the usual account's.
    const home = tap?.transcriptPath ? homeOf(tap.transcriptPath, list) : list[0];
    if (home && !out.has(home)) out.set(home, { fiveHour: live(tap?.fiveHour ?? null), sevenDay: live(tap?.sevenDay ?? null), observedAt: f.at });
  }
  return list.map((h) => out.get(h) ?? NO_USAGE);
}

export interface PermissionAsk {
  at: number; // file time
  toolName: string;
  toolInput: Record<string, unknown>;
  effort: string | null;
}

/** What the session's latest permission prompt asked, as the hook saved it. */
export async function readPermission(sessionId: string): Promise<PermissionAsk | null> {
  const file = join(HOOK_DIR, `${sessionId}.json`);
  try {
    const at = (await stat(file)).mtimeMs;
    const d = JSON.parse(await readFile(file, "utf8"));
    if (typeof d.tool_name !== "string") return null;
    return { at, toolName: d.tool_name, toolInput: d.tool_input ?? {}, effort: d.effort?.level ?? null };
  } catch {
    return null;
  }
}
