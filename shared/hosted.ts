// Names of the tmux sessions Control Room starts. The server and the page both read them from Claude Code's
// "session:@window.%pane", so they parse it in one place.

// cr- runs Claude Code; crt- is a terminal: a shell started here; cra- another coding agent, such as Codex.
export const NAME_PATTERN = "cr[ta]?-[0-9a-f]{8}"; // for routes that take one
const NAME = new RegExp(`^${NAME_PATTERN}$`);

export function isHostedName(name: unknown): name is string {
  return typeof name === "string" && NAME.test(name);
}

export function isTerminalName(name: string): boolean {
  return name.startsWith("crt-");
}

export function isAgentName(name: string): boolean {
  return name.startsWith("cra-");
}

/** The tmux session name in Claude Code's "session:@window.%pane", when it is one Control Room started. */
export function hostedName(tmux: string | null): string | null {
  const name = tmux?.split(":")[0] ?? null;
  return isHostedName(name) ? name : null;
}
