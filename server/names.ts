// Session names. The name on the session's VS Code tab comes first: it is the name the person gave the session.
import type { Session } from "../shared/types.ts";

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
  if (p.custom) return [p.custom, "custom"];
  if (p.title) return [p.title, "title"];
  if (p.story) return [p.story, "story"];
  // A branch or folder name says little; the plain-English headline is the better name then.
  if (p.headline) return [p.headline, "summary"];
  if (p.branch) return [p.branch, "branch"];
  return [p.folder, "folder"];
}
