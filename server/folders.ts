// Folders you sort sessions into, such as "Code reviews" or "Troubleshoot". Kept in ~/.claude-control-room/folders.json:
// the folders in the order you made them, and the folder of each session by its id, so a session stays in its folder
// after a restart.
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cleanName } from "./names.ts";
import { APP_DIR } from "./paths.ts";

const FILE = join(APP_DIR, "folders.json");
const MAX_SESSIONS = 500; // sessions remembered, the ones put in a folder last kept
export const MAX_FOLDER = 40;

interface Stored {
  names: string[];
  of: Map<string, string>; // session id to folder name
}

let stored: Stored | null = null;
let writing: Promise<void> = Promise.resolve();

function load(): Stored {
  if (stored) return stored;
  stored = { names: [], of: new Map() };
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as { folders?: unknown; sessions?: Record<string, unknown> };
    if (Array.isArray(raw.folders)) for (const n of raw.folders) addName(stored, cleanFolder(n));
    for (const [id, name] of Object.entries(raw.sessions ?? {})) if (typeof name === "string" && stored.names.includes(name)) stored.of.set(id, name);
  } catch {
    /* none yet */
  }
  return stored;
}

function addName(s: Stored, name: string | null): void {
  if (name && !s.names.includes(name)) s.names.push(name);
}

/** One line, at most MAX_FOLDER characters; null when nothing is left. */
export function cleanFolder(raw: unknown): string | null {
  const name = cleanName(raw);
  return name ? [...name].slice(0, MAX_FOLDER).join("").trim() : null;
}

export function folderNames(): string[] {
  return [...load().names];
}

export function folderOf(sessionId: string): string | null {
  return load().of.get(sessionId) ?? null;
}

/** Puts the session in the folder, made if it is new; null takes it out of its folder. */
export function setFolder(sessionId: string, folder: string | null): Promise<void> {
  const s = load();
  s.of.delete(sessionId);
  if (folder) {
    addName(s, folder);
    s.of.set(sessionId, folder);
    for (const old of s.of.keys()) {
      if (s.of.size <= MAX_SESSIONS) break;
      s.of.delete(old);
    }
  }
  return save();
}

/** Renames a folder, with its sessions. Into a folder that already exists, the two become one. */
export function renameFolder(from: string, to: string): Promise<void> {
  const s = load();
  const at = s.names.indexOf(from);
  if (at < 0 || from === to) return writing;
  if (s.names.includes(to)) s.names.splice(at, 1);
  else s.names[at] = to;
  for (const [id, name] of s.of) if (name === from) s.of.set(id, to);
  return save();
}

/** Removes a folder. Its sessions stay, out of any folder. */
export function removeFolder(name: string): Promise<void> {
  const s = load();
  s.names = s.names.filter((n) => n !== name);
  for (const [id, n] of [...s.of]) if (n === name) s.of.delete(id);
  return save();
}

/** Moves a folder one place up or down the list. */
export function shiftFolder(name: string, by: -1 | 1): Promise<void> {
  const s = load();
  const at = s.names.indexOf(name);
  const to = at + by;
  if (at < 0 || to < 0 || to >= s.names.length) return writing;
  [s.names[at], s.names[to]] = [s.names[to], s.names[at]];
  return save();
}

/** Writes run one at a time, each with the state as it is when its turn comes. */
function save(): Promise<void> {
  const write = async () => {
    const s = load();
    const text = JSON.stringify({ folders: s.names, sessions: Object.fromEntries(s.of) }, null, 2) + "\n";
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(`${FILE}.tmp`, text);
    await rename(`${FILE}.tmp`, FILE);
  };
  writing = writing.then(write, write);
  return writing;
}
