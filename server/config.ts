import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isIdeId } from "../shared/ides.ts";
import type { Settings } from "../shared/types.ts";
import { CONFIG_FILE } from "./paths.ts";

export const DEFAULT_SETTINGS: Settings = {
  notifications: true,
  sounds: true,
  aiSummaries: true,
  inactiveAfterMinutes: 120,
  includeIdePanel: false,
  ide: "vscode",
  layout: "fit",
  shortcutTokens: [],
};

let current: Settings = { ...DEFAULT_SETTINGS };

/** Saved settings over the defaults. An IDE this build does not know (from a newer build, or typed by hand) falls back. */
export function cleanSettings(raw: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  if (!isIdeId(s.ide)) s.ide = DEFAULT_SETTINGS.ide;
  return s;
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

/** The UI never receives a token, only its last four characters. */
export function publicSettings(): Settings {
  return { ...current, shortcutTokens: current.shortcutTokens.map((t) => `••••${t.slice(-4)}`) };
}
