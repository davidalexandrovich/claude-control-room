import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import type { ServerResponse } from "node:http";
import type { SetupState } from "../shared/types.ts";
import { VSCODE_APP, VSCODE_CLI, VSCODE_EXTENSIONS_DIR, VSCODE_HELPER_ID } from "./paths.ts";
import { launch, run, sleep } from "./proc.ts";

export interface BridgeTerminal {
  pid: number; // the shell pid VS Code started
  name: string;
}

interface BridgeWindow {
  id: string;
  folders: string[];
  focused: boolean;
  terminals: BridgeTerminal[];
  features: string[]; // what this copy of the helper can do beyond focus, send and close
  stream: ServerResponse;
  seenAt: number;
}

// A helper that lacks one of these is outdated; Settings offers the update.
const FEATURES = ["rename"];

const windows = new Map<string, BridgeWindow>();
const waiting = new Map<string, (result: { ok: boolean; message: string }) => void>();

export function bridgeConnected(): number {
  return windows.size;
}

/** "outdated" when a window still runs a helper too old for everything this version does. */
export function helperState(): SetupState["vscodeHelper"] {
  if (windows.size === 0) return helperInstalled() ? "installed" : "missing";
  return [...windows.values()].every((w) => FEATURES.every((f) => w.features.includes(f))) ? "connected" : "outdated";
}

export function helperInstalled(): boolean {
  try {
    return readdirSync(VSCODE_EXTENSIONS_DIR).some((n) => n.startsWith(`${VSCODE_HELPER_ID}-`));
  } catch {
    return false;
  }
}

export function openStream(windowId: string, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
  res.write(`event: hello\ndata: {}\n\n`);
  const existing = windows.get(windowId);
  windows.set(windowId, {
    id: windowId,
    folders: existing?.folders ?? [],
    focused: existing?.focused ?? false,
    terminals: existing?.terminals ?? [],
    features: existing?.features ?? [],
    stream: res,
    seenAt: Date.now(),
  });
  const ping = setInterval(() => res.write(`: ping\n\n`), 15_000);
  res.on("close", () => {
    clearInterval(ping);
    if (windows.get(windowId)?.stream === res) windows.delete(windowId);
  });
}

export function updateWindow(body: { windowId: string; folders: string[]; focused: boolean; terminals: BridgeTerminal[]; features?: string[] }): void {
  const w = windows.get(body.windowId);
  if (!w) return;
  w.folders = body.folders ?? [];
  w.focused = body.focused === true;
  w.terminals = (body.terminals ?? []).filter((t) => Number.isInteger(t.pid));
  w.features = Array.isArray(body.features) ? body.features.filter((f) => typeof f === "string") : [];
  w.seenAt = Date.now();
}

export function resolveResult(body: { requestId: string; ok: boolean; message: string }): void {
  waiting.get(body.requestId)?.({ ok: body.ok === true, message: String(body.message ?? "") });
  waiting.delete(body.requestId);
}

export function windowFor(shellPid: number): BridgeWindow | null {
  for (const w of windows.values()) if (w.terminals.some((t) => t.pid === shellPid)) return w;
  return null;
}

/** The name on the terminal's VS Code tab, as the helper last reported it. */
export function terminalName(shellPid: number): string | null {
  return windowFor(shellPid)?.terminals.find((t) => t.pid === shellPid)?.name ?? null;
}

function command(w: BridgeWindow, cmd: Record<string, unknown>, timeoutMs = 4_000): Promise<{ ok: boolean; message: string }> {
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(requestId);
      resolve({ ok: false, message: "VS Code did not answer in time" });
    }, timeoutMs);
    waiting.set(requestId, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    w.stream.write(`event: command\ndata: ${JSON.stringify({ ...cmd, requestId })}\n\n`);
  });
}

/** Brings the VS Code window forward, then shows the terminal that runs the session. */
export async function focusTerminal(shellPid: number): Promise<{ ok: boolean; message: string }> {
  const w = windowFor(shellPid);
  if (!w) {
    launch("open", ["-a", VSCODE_APP]);
    return { ok: false, message: "Opened VS Code. Install the VS Code helper to jump straight to the session's terminal." };
  }
  if (w.folders[0] && existsSync(VSCODE_CLI)) {
    // `code <folder>` raises the window that already has the folder open instead of opening a new one.
    await run(VSCODE_CLI, [w.folders[0]], { timeoutMs: 8_000 });
  } else {
    launch("open", ["-a", VSCODE_APP]);
  }
  await sleep(150);
  return command(w, { type: "focus", pid: shellPid });
}

export async function sendText(shellPid: number, text: string): Promise<{ ok: boolean; message: string }> {
  const w = windowFor(shellPid);
  if (!w) return { ok: false, message: "This terminal is not reachable. Install the VS Code helper first." };
  return command(w, { type: "send", pid: shellPid, text });
}

/** Renames the terminal's VS Code tab. */
export async function renameTerminal(shellPid: number, name: string): Promise<{ ok: boolean; message: string }> {
  const w = windowFor(shellPid);
  if (!w) return { ok: false, message: "This terminal is not reachable. Install the VS Code helper first (Settings)." };
  if (!w.features.includes("rename")) {
    return { ok: false, message: "Update the VS Code helper first: Settings → VS Code helper → Update. Then run “Developer: Restart Extension Host” in VS Code." };
  }
  const r = await command(w, { type: "rename", pid: shellPid, name });
  // Show the new name now; the helper reports it again right after.
  const t = r.ok ? w.terminals.find((x) => x.pid === shellPid) : null;
  if (t) t.name = name;
  return r;
}

export async function closeTerminal(shellPid: number): Promise<{ ok: boolean; message: string }> {
  const w = windowFor(shellPid);
  if (!w) return { ok: false, message: "VS Code helper not connected; the terminal tab stays open." };
  return command(w, { type: "close", pid: shellPid });
}

export async function installHelper(vsixPath: string): Promise<{ ok: boolean; message: string }> {
  if (!existsSync(VSCODE_CLI)) return { ok: false, message: "VS Code was not found in /Applications." };
  if (!existsSync(vsixPath)) return { ok: false, message: `The helper package is missing: ${vsixPath}` };
  const update = windows.size > 0;
  const out = await run(VSCODE_CLI, ["--install-extension", vsixPath, "--force"], { timeoutMs: 60_000 });
  if (!out.ok) return { ok: false, message: (out.stderr || out.stdout).trim() };
  if (update) return { ok: true, message: "Updated. In VS Code, run “Developer: Restart Extension Host” to start the new helper. Your terminals keep running." };
  return { ok: true, message: "Installed. If a VS Code window does not connect within a minute, run “Developer: Reload Window” in it." };
}
