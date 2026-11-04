// Session names. A name the person gave the session comes first: on its VS Code tab, or saved here for any other terminal.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Session } from "../shared/types.ts";
import { NAMES_FILE } from "./paths.ts";

export const MAX_NAME = 120;

// Names a terminal gets by itself: the shell, the program that runs in it, or Claude Code's default title.
const AUTOMATIC = /^(zsh|bash|sh|fish|nu|pwsh|powershell|tmux|screen|login|node|bun|claude|claude code|\d+(\.\d+)+)$/i;
// Claude Code puts its own title on the tab with a mark in front: ✳ while idle, ◐ or ◑ while it works.
const CLAUDE_TITLE = /^[✳◐◑]\s/;

/** One line without control characters, at most MAX_NAME characters; null when nothing is left. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();
  return name ? [...name].slice(0, MAX_NAME).join("").trim() : null;
}

/** The VS Code tab's name when a person gave it one, or null. */
export function tabName(raw: unknown): string | null {
  const name = cleanName(raw);
  return name && !AUTOMATIC.test(name) && !CLAUDE_TITLE.test(name) ? name : null;
}

export interface NameParts {
  tab: string | null; // the VS Code tab's name
  saved: string | null; // given in Control Room to a session without a VS Code tab
  custom: string | null; // set with /rename in Claude Code
  title: string | null; // Claude Code's own title for the session
  story: string | null;
  headline: string | null; // the plain-English summary, when there is one
  branch: string | null;
  folder: string;
}

/** The session's name and where it came from, in the order the README gives. */
export function pickName(p: NameParts): [string, Session["nameSource"]] {
  if (p.tab) return [p.tab, "tab"];
  if (p.saved) return [p.saved, "saved"];
  if (p.custom) return [p.custom, "custom"];
  if (p.title) return [p.title, "title"];
  if (p.story) return [p.story, "story"];
  // A branch or folder name says little; the plain-English headline is the better name then.
  if (p.headline) return [p.headline, "summary"];
  if (p.branch) return [p.branch, "branch"];
  return [p.folder, "folder"];
}

// Names given in Control Room to sessions that have no VS Code tab to hold them, by session id, oldest first.
const MAX_SAVED = 500;
let saved: Promise<Map<string, string>> | null = null;
let writing: Promise<void> = Promise.resolve();

function parseNames(text: string): Map<string, string> {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${NAMES_FILE} is not a list of names`);
  return new Map(Object.entries(raw));
}

// One read for everyone: two callers that each read the file would each get their own map, and one would lose its name.
function savedNames(): Promise<Map<string, string>> {
  if (!saved) {
    const load = readFile(NAMES_FILE, "utf8").then(parseNames, (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return new Map<string, string>();
      throw err;
    });
    // A file that could not be read is never written over; the next call reads it again.
    load.catch(() => {
      if (saved === load) saved = null;
    });
    saved = load;
  }
  return saved;
}

export async function savedName(sessionId: string): Promise<string | null> {
  try {
    return cleanName((await savedNames()).get(sessionId));
  } catch {
    return null;
  }
}

/** Saves the name, or forgets it when null. Writes run one at a time, and the name shows only once it is on disk. */
export function saveName(sessionId: string, name: string | null): Promise<void> {
  const write = async () => {
    const next = new Map(await savedNames());
    next.delete(sessionId);
    if (name) next.set(sessionId, name);
    for (const old of next.keys()) {
      if (next.size <= MAX_SAVED) break;
      next.delete(old);
    }
    await mkdir(dirname(NAMES_FILE), { recursive: true });
    const tmp = `${NAMES_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(next), null, 2) + "\n");
    await rename(tmp, NAMES_FILE);
    saved = Promise.resolve(next);
  };
  writing = writing.then(write, write);
  return writing;
}
