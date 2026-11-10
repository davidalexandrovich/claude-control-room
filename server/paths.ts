import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = homedir();
// The usual account's Claude Code config folder. Others are in Settings; accounts.ts has the folders inside each.
export const CLAUDE_DIR = join(HOME, ".claude");

export const APP_DIR = join(HOME, ".claude-control-room");
export const CONFIG_FILE = join(APP_DIR, "config.json");
export const TAP_DIR = join(APP_DIR, "statusline");
export const TAP_SCRIPT = join(APP_DIR, "statusline-tap.sh");
export const HOOK_SCRIPT = join(APP_DIR, "permission-hook.sh");
export const HOOK_DIR = join(APP_DIR, "permissions");
export const SUMMARY_DIR = join(APP_DIR, "summaries");
export const SUMMARIZER_CWD = join(APP_DIR, "summarizer");
export const BACKUP_DIR = join(APP_DIR, "backups");
export const BRIDGE_FILE = join(APP_DIR, "bridge.json");
export const NAMES_FILE = join(APP_DIR, "names.json");
export const TICKET_TITLES_FILE = join(APP_DIR, "ticket-titles.json");

export const VSCODE_EXTENSIONS_DIR = join(HOME, ".vscode", "extensions");
export const VSCODE_HELPER_ID = "local.control-room-bridge";
