import { realpathSync, statSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";
import { MAX_ACCOUNTS } from "../shared/claude.ts";
import { isIdeId } from "../shared/ides.ts";
import { cleanPrompts } from "../shared/prompts.ts";
import type { AccountRef, Settings } from "../shared/types.ts";
import { chosenIde } from "./ide.ts";
import { APP_DIR, CLAUDE_DIR, CONFIG_FILE, HOME } from "./paths.ts";

export const DEFAULT_SETTINGS: Settings = {
  notifications: true,
  sounds: true,
  aiSummaries: true,
  inactiveAfterMinutes: 120,
  includeIdePanel: false,
  ide: "vscode",
  terminalFolder: HOME,
  layout: "fit",
  shortcutTokens: [],
  accounts: [],
  defaultAccountLabel: "Default",
  newSessionAccount: "",
  prompts: [],
};

let current: Settings = { ...DEFAULT_SETTINGS };

/** Saved settings over the defaults. An IDE this build does not know (from a newer build, or typed by hand) falls back. */
export function cleanSettings(raw: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  if (!isIdeId(s.ide)) s.ide = DEFAULT_SETTINGS.ide;
  s.accounts = cleanAccounts(s.accounts);
  s.defaultAccountLabel = accountLabel(s.defaultAccountLabel) ?? DEFAULT_SETTINGS.defaultAccountLabel;
  if (!s.accounts.some((a) => a.dir === s.newSessionAccount)) s.newSessionAccount = "";
  s.prompts = cleanPrompts(s.prompts);
  return s;
}

/** A full path typed in Settings, ~ for home, without a trailing slash; null when it is not a full path. */
function typedPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim().replace(/^~(?=$|\/)/, HOME);
  return isAbsolute(path) ? normalize(path).replace(/(.)\/$/, "$1") : null;
}

// A Mac's folders ignore case, and a link leads to another folder: each spelling of one folder must count as that one.
function folderKey(dir: string): string {
  try {
    return realpathSync(dir).toLowerCase();
  } catch {
    return dir.toLowerCase(); // not made yet
  }
}

/** One folder is the other, or holds it. */
export function overlaps(a: string, b: string): boolean {
  const [x, y] = [folderKey(a), folderKey(b)];
  const inside = (p: string, q: string) => p === q || p.startsWith(q.endsWith("/") ? q : q + "/");
  return inside(x, y) || inside(y, x);
}

/**
 * A Claude Code config folder for another account, ~ for home. It need not exist yet; Claude Code makes it at the
 * first sign-in. ~/.claude, anything in it and anything holding it (~, /) would mix with the usual account's files,
 * and Control Room's own folder holds its own.
 */
export function accountDir(raw: unknown): string | null {
  const dir = typedPath(raw);
  return dir && !overlaps(dir, CLAUDE_DIR) && !overlaps(dir, APP_DIR) ? dir : null;
}

export function accountLabel(raw: unknown): string | null {
  const label = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, 30) : "";
  return label || null;
}

/** The accounts from a saved file: each with a label and a folder of its own, apart from every other one's. */
export function cleanAccounts(raw: unknown): AccountRef[] {
  const out: AccountRef[] = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    const dir = accountDir(a?.dir);
    const label = accountLabel(a?.label);
    if (dir && label && out.length < MAX_ACCOUNTS && !out.some((o) => overlaps(o.dir, dir))) out.push({ label, dir });
  }
  return out;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, "utf8")) as Partial<Settings>;
    current = cleanSettings(raw);
  } catch {
    current = { ...DEFAULT_SETTINGS };
  }
  const envToken = process.env.SHORTCUT_API_TOKEN;
  if (envToken && !current.shortcutTokens.includes(envToken)) {
    current.shortcutTokens = [...current.shortcutTokens, envToken];
  }
  return current;
}

/** A folder typed in Settings, ~ for home, if it is a folder on this Mac. */
export function folderSetting(raw: unknown): string | null {
  const path = typedPath(raw);
  if (!path) return null;
  try {
    return statSync(path).isDirectory() ? path : null;
  } catch {
    return null;
  }
}

export function settings(): Settings {
  return current;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  current = { ...current, ...patch };
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  const tmp = `${CONFIG_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, CONFIG_FILE);
  await chmod(CONFIG_FILE, 0o600);
  return current;
}

/** The UI never receives a token, only its last four characters. It gets the IDE "Open in" uses. */
export function publicSettings(): Settings {
  return { ...current, ide: chosenIde(current.ide), shortcutTokens: current.shortcutTokens.map((t) => `••••${t.slice(-4)}`) };
}
