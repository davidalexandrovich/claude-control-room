// Chrome keeps one profile per Google account. A session's links open in the profile signed in to the same email as
// the session's Claude account: a claude.ai link from a personal session lands where the personal account is signed in.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HOME } from "./paths.ts";

const LOCAL_STATE = join(HOME, "Library", "Application Support", "Google", "Chrome", "Local State");

/** Pure: Chrome's profile folders by the email signed in to each (lowercase); null when the text is not Local State. */
export function profilesByEmail(localState: string): Map<string, string> | null {
  let cache: Record<string, { user_name?: unknown }>;
  try {
    cache = JSON.parse(localState)?.profile?.info_cache;
  } catch {
    return null; // half written
  }
  if (!cache || typeof cache !== "object") return null;
  const out = new Map<string, string>();
  for (const [dir, p] of Object.entries(cache)) {
    const email = typeof p?.user_name === "string" ? p.user_name.trim().toLowerCase() : "";
    // The folder goes into a shell script, so only names like Chrome's own: Default, Profile 4.
    if (email && /^[A-Za-z0-9 _-]+$/.test(dir) && !out.has(email)) out.set(email, dir);
  }
  return out;
}

/** Chrome's profiles as they are now; null when there is no Chrome, or its file could not be read this time. */
export async function chromeProfiles(): Promise<Map<string, string> | null> {
  const text = await readFile(LOCAL_STATE, "utf8").catch(() => null);
  return text === null ? null : profilesByEmail(text);
}

export function profileOf(profiles: Map<string, string> | null, email: string | null): string | null {
  return (email && profiles?.get(email.trim().toLowerCase())) || null;
}

/** What `open` takes to show a link in one Chrome profile; while Chrome runs, it goes to the window of that profile. */
export function chromeArgs(profile: string, url: string): string[] {
  return ["-na", "Google Chrome", "--args", `--profile-directory=${profile}`, url];
}

/**
 * Pure: the script an account's sessions run as $BROWSER. Claude Code runs it with each link it opens: sign-ins,
 * connectors, links clicked in the session. Without a matching profile it is plain `open`, the default browser.
 */
export function linkScript(profile: string | null): string {
  const open = profile ? `open ${chromeArgs(profile, "$1").map((a) => (a === "$1" ? '"$1"' : `'${a}'`)).join(" ")} 2>/dev/null || open "$1"` : `open "$1"`;
  return `#!/bin/sh
# Control Room (installed by the app): opens the links of this account's sessions in its own Chrome profile.
# A sign-in started from Control Room hands its link to the app instead, for a private window.
if [ -n "$CONTROL_ROOM_SIGNIN" ]; then
  printf '%s\\n' "$1" > "$CONTROL_ROOM_SIGNIN"
  exit 0
fi
${open}
`;
}
