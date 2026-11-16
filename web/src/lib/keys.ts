// Every shortcut, written once: the keyboard handler, the tips, the session menu and the Keyboard shortcuts panel all
// read it. The ⌘ and F-key ones follow PyCharm and the Mac, and work while a console has the keyboard; the single keys
// work everywhere else. In a session's menu, the keys act on that session.

export const KEYS = {
  newSession: { keys: ["⌘N", "N"], label: "New session" },
  newTerminal: { keys: ["⌘T", "T"], label: "New terminal" },
  settings: { keys: ["⌘,"], label: "Settings" },
  help: { keys: ["⌘/", "?"], label: "Keyboard shortcuts" },
  layout: { keys: ["F"], label: "Switch between Focus and Fit" },
  jump: { keys: ["⌘K", "⌘E"], label: "Go to a session: type part of its name" },
  next: { keys: ["⌘↓", "⌃⇥", "→"], label: "Next session" },
  prev: { keys: ["⌘↑", "⌃⇧⇥", "←"], label: "Previous session" },
  below: { keys: ["↓"], label: "The session below" },
  above: { keys: ["↑"], label: "The session above" },
  ends: { keys: ["Home", "End"], label: "The first or last session" },
  pick: { keys: ["⌘1–9", "1–9"], label: "Go to session 1 to 9" },
  open: { keys: ["↵"], label: "Open it: type in its console, or go to its terminal" },
  leave: { keys: ["⇧Esc"], label: "Leave the console, so these keys work again" },
  details: { keys: ["Space"], label: "Show or hide its details" },
  rename: { keys: ["⌘R", "F2", "⇧F6"], label: "Rename it" },
  approve: { keys: ["A"], label: "Approve what it asks" },
  reject: { keys: ["R"], label: "Reject what it asks" },
  answer: { keys: ["1–4"], label: "Pick that answer, in its menu" },
  pr: { keys: ["P"], label: "Open its PR" },
  close: { keys: ["X"], label: "Close it…" },
  back: { keys: ["Esc"], label: "Close a menu, a panel, the details or a full console, or clear the marks" },
  mark: { keys: ["⌘-click"], label: "Mark it, to close several at once. A click on its number box does too" },
  ide: { keys: ["⌘O"], label: "Open its folder in your IDE" },
  popout: { keys: ["⇧F4"], label: "Pop it out to its own window" },
  remote: { keys: ["C"], label: "Continue it on your phone" },
  finder: { keys: ["⌥⌘R"], label: "Show its folder in Finder" },
  moveFront: { keys: ["⇧Home"], label: "Move it to the front" },
  moveEnd: { keys: ["⇧End"], label: "Move it to the end" },
  copyResume: { keys: ["⌘⇧C"], label: "Copy its resume command" },
  copyId: { keys: ["⌥⌘⇧C"], label: "Copy its session ID" },
} as const satisfies Record<string, { keys: readonly string[]; label: string }>;

export type KeyId = keyof typeof KEYS;

export const KEY_GROUPS: { title: string; ids: KeyId[] }[] = [
  { title: "Start", ids: ["newSession", "newTerminal", "settings", "help", "layout"] },
  { title: "Move between sessions", ids: ["jump", "next", "prev", "below", "above", "ends", "pick"] },
  { title: "The selected session", ids: ["open", "leave", "details", "rename", "approve", "reject", "answer", "pr", "close", "mark", "back"] },
  { title: "More for it", ids: ["ide", "popout", "remote", "finder", "moveFront", "moveEnd", "copyResume", "copyId"] },
];

/** A tip with its shortcut after it, the way a Mac menu shows one: "New session (⌘N)". */
export function withKey(label: string, id: KeyId): string {
  return `${label} (${KEYS[id].keys[0]})`;
}

/** What a key does to one session: the selected one, or the one whose menu is open. */
export type SessionKey =
  | { id: "open" | "details" | "rename" | "approve" | "reject" | "pr" | "close" | "ide" | "popout" | "remote" | "finder" | "moveFront" | "moveEnd" | "copyResume" | "copyId" }
  | { id: "answer"; n: number };

type SessionCommand = { id: "rename" | "popout" | "finder" | "copyResume" | "copyId" | "ide" };

export type Command =
  | { id: "newSession" | "newTerminal" | "settings" | "help" | "jump" | "next" | "prev" | "leave" }
  | { id: "pick"; n: number }
  | SessionCommand;

/**
 * The shortcut a key press is, of those that work everywhere: in a console, too, where every other key goes to the
 * session. None of them means anything to a shell or to Claude Code.
 */
export function commandOf(e: KeyboardEvent): Command | null {
  // ⌥ turns letters into other characters on a Mac, so these go by the key's place.
  if (e.metaKey && e.altKey && !e.ctrlKey) {
    if (e.code === "KeyR" && !e.shiftKey) return { id: "finder" };
    if (e.code === "KeyC" && e.shiftKey) return { id: "copyId" };
    return null;
  }
  if (e.altKey) return null;
  if (e.ctrlKey && !e.metaKey && e.key === "Tab") return { id: e.shiftKey ? "prev" : "next" };
  if (e.ctrlKey) return null;
  if (!e.metaKey) {
    if (e.shiftKey && e.key === "F6") return { id: "rename" };
    if (e.shiftKey && e.key === "F4") return { id: "popout" };
    if (e.shiftKey && e.key === "Escape") return { id: "leave" };
    return null;
  }
  if (e.shiftKey) return e.code === "KeyC" ? { id: "copyResume" } : null;
  // R for Rename, with one hand and no Fn. By the key's place, so a Hebrew layout gets it too.
  if (e.code === "KeyR") return { id: "rename" };
  // O for Open, with ⌘ so a stray O doesn't open the IDE.
  if (e.code === "KeyO") return { id: "ide" };
  // Up and down the list, as ⌘ and an arrow go to the top or bottom of one elsewhere on a Mac.
  if (e.key === "ArrowDown") return { id: "next" };
  if (e.key === "ArrowUp") return { id: "prev" };
  if (/^[1-9]$/.test(e.key)) return { id: "pick", n: Number(e.key) };
  const key = e.key.toLowerCase();
  // ⌘K finds as in Slack and VS Code; ⌘E is PyCharm's Recent Files.
  if (key === "k" || key === "e") return { id: "jump" };
  return key === "n" ? { id: "newSession" } : key === "t" ? { id: "newTerminal" } : key === "," ? { id: "settings" } : key === "/" ? { id: "help" } : null;
}

const SESSION_COMMANDS: readonly string[] = ["rename", "popout", "finder", "copyResume", "copyId", "ide"];

/** A command that acts on one session. */
export function isSessionCommand(c: Command): c is SessionCommand {
  return SESSION_COMMANDS.includes(c.id);
}

/**
 * The single key for something to do to a session, outside a console and a text box. `inMenu`: the keys 1 to 4 pick an
 * answer there, as its numbers show, instead of a session.
 */
export function sessionKeyOf(e: KeyboardEvent, inMenu = false): SessionKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.shiftKey) return e.key === "Home" ? { id: "moveFront" } : e.key === "End" ? { id: "moveEnd" } : null;
  if (inMenu && /^[1-4]$/.test(e.key)) return { id: "answer", n: Number(e.key) };
  if (e.key === "Enter") return { id: "open" };
  if (e.key === " ") return { id: "details" };
  if (e.key === "F2") return { id: "rename" };
  const id = LETTERS[e.key.toLowerCase()];
  return id ? { id } : null;
}

const LETTERS: Record<string, Exclude<SessionKey, { id: "answer" }>["id"]> = { a: "approve", r: "reject", p: "pr", x: "close", c: "remote" };
