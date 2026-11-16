// Remote Control: Claude Code's /remote-control puts a running session in the Claude app and at claude.ai/code.

// The space closes the command menu, so Enter runs this command and never a suggestion still on screen.
export const REMOTE_COMMAND = "/remote-control ";

/** The name claude.ai gets for the session: its name here on one line, or "" while it is only "New session". */
export function remoteTitle(name: string, nameSource: string): string {
  if (nameSource === "new") return "";
  return name.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 100).trim();
}

/** /remote-control with the session's name, so claude.ai shows the name Control Room shows. */
export function remoteCommand(title: string): string {
  // The trailing space also closes a suggestion menu that a "#" or "@" in the name opened.
  return title ? `${REMOTE_COMMAND}${title} ` : REMOTE_COMMAND;
}

/** Ctrl+E, then Ctrl+U six times: clears an unsent draft of up to three lines. Ctrl+Y in the session brings it back. */
export const CLEAR_DRAFT: [text: string, tmuxKey: string][] = [["\u0005", "C-e"], ...Array.from({ length: 6 }, (): [string, string] => ["\u0015", "C-u"])];

/** The id Claude Code keeps in the session file while Remote Control is on, or null. */
export function bridgeIdOf(raw: unknown): string | null {
  return typeof raw === "string" && /^session_[A-Za-z0-9]+$/.test(raw) ? raw : null;
}

export function remoteUrl(bridgeId: string | null): string | null {
  return bridgeId ? `https://claude.ai/code/${bridgeId}` : null;
}

/** Why /remote-control must not be typed into the session right now, or null when it is safe. */
export function remoteRefusal(file: { status: string | null } | null): string | null {
  if (!file) return "That session is gone.";
  // An open prompt takes every key, and Enter there would approve or answer it.
  if (file.status === "waiting") return "Answer the session first, then try again.";
  return null;
}
