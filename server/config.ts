import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, "utf8")) as Partial<Settings>;
    current = { ...DEFAULT_SETTINGS, ...raw };
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
