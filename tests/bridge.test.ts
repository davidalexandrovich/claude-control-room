// The VS Code helper against a real server: it must register its terminals and carry out commands.
import { mkdtempSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const home = mkdtempSync(join(tmpdir(), "cr-home-"));
process.env.HOME = home;

const calls: string[] = [];
const noop = () => ({ dispose() {} });
// Like VS Code, the fake updates the active terminal and a tab's name a moment after it is asked to.
const later = (fn: () => void) => setTimeout(fn, 30);
type FakeTerminal = { name: string; processId: Promise<number>; show: (preserveFocus: boolean) => void; sendText: (text: string, newLine: boolean) => void; dispose: () => void };
function fakeTerminal(name: string, pid: number): FakeTerminal {
  const t: FakeTerminal = {
    name,
    processId: Promise.resolve(pid),
    show: (preserveFocus) => {
      calls.push(`show:${pid}:${preserveFocus}`);
      later(() => (fakeVscode.window.activeTerminal = t));
    },
    sendText: (text, newLine) => calls.push(`send:${JSON.stringify(text)}:${newLine}`),
    dispose: () => calls.push("dispose"),
  };
  return t;
}
const terminal = fakeTerminal("zsh", 4242);
const other = fakeTerminal("Notes", 4343);
const fakeVscode = {
  window: {
    terminals: [terminal, other],
    activeTerminal: other as FakeTerminal | undefined,
    state: { focused: true },
    onDidOpenTerminal: noop,
    onDidCloseTerminal: noop,
    onDidChangeWindowState: noop,
  },
  workspace: { workspaceFolders: [{ uri: { fsPath: join(home, "repo") } }], onDidChangeWorkspaceFolders: noop },
  commands: {
    executeCommand: async (id: string, args: { name: string }) => {
      calls.push(`command:${id}`);
      const active = fakeVscode.window.activeTerminal;
      if (id === "workbench.action.terminal.renameWithArg" && active) later(() => (active.name = args.name));
    },
  },
};

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (request: string, parent: unknown, isMain: boolean) {
  return request === "vscode" ? fakeVscode : realLoad.call(this, request, parent, isMain);
};

let stop: () => Promise<void> = async () => {};
let activatedAt = 0;
let ext: { activate: (ctx: { subscriptions: unknown[] }) => void; deactivate: () => void };
let vscode: typeof import("../server/vscode.ts");

async function until(check: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  const { startServer } = await import("../server/main.ts");
  vscode = await import("../server/vscode.ts");
  const running = await startServer({ port: 46000 + Math.floor(Math.random() * 2000) });
  stop = running.stop;
  ext = createRequire(import.meta.url)("../vscode-extension/extension.js");
  ext.activate({ subscriptions: [] });
  activatedAt = Date.now();
});

afterAll(async () => {
  ext?.deactivate();
  mod._load = realLoad;
  await stop();
});

describe("VS Code helper", () => {
  it("registers the window and its terminals", async () => {
    await until(() => vscode.windowFor(4242) !== null);
    expect(vscode.bridgeConnected()).toBe(1);
    expect(vscode.windowFor(4242)?.folders).toEqual([join(home, "repo")]);
  });

  it("sends a raw key without a newline, which is how approve and reject work", async () => {
    const r = await vscode.sendText(4242, "\r");
    expect(r.ok).toBe(true);
    expect(calls).toContain('send:"\\r":false');
  });

  it("passes control keys through unchanged, which is how rc clears a draft", async () => {
    expect((await vscode.sendText(4242, "\u0015")).ok).toBe(true);
    expect(calls).toContain('send:"\\u0015":false');
  });

  it("renames the right tab, then gives the other terminal its place back", async () => {
    const r = await vscode.renameTerminal(4242, "Dark mode 2");
    expect(r).toEqual({ ok: true, message: "Renamed" });
    expect(terminal.name).toBe("Dark mode 2");
    expect(other.name).toBe("Notes");
    expect(vscode.terminalName(4242)).toBe("Dark mode 2");
    expect(calls.filter((c) => c.startsWith("show:"))).toEqual(["show:4242:true", "show:4343:true"]);
    await until(() => fakeVscode.window.activeTerminal === other);
  });

  it("reports a tab renamed in VS Code within a few seconds", async () => {
    // Wait out the reports the helper sends anyway (after a rename, and once 3 s after start), so only the name watcher can catch this.
    await new Promise((r) => setTimeout(r, Math.max(400, activatedAt + 3300 - Date.now())));
    terminal.name = "Search | Regression tests";
    await until(() => vscode.terminalName(4242) === "Search | Regression tests", 2600);
  });

  it("asks for an update when an older helper cannot rename", async () => {
    const w = vscode.windowFor(4242)!;
    vscode.updateWindow({ windowId: w.id, folders: w.folders, focused: w.focused, terminals: w.terminals });
    expect(vscode.helperState()).toBe("outdated");
    expect((await vscode.renameTerminal(4242, "x")).message).toMatch(/Update the VS Code helper/);
    vscode.updateWindow({ windowId: w.id, folders: w.folders, focused: w.focused, terminals: w.terminals, features: ["rename"] });
    expect(vscode.helperState()).toBe("connected");
  });

  it("closes the terminal and refuses a terminal it does not own", async () => {
    expect((await vscode.closeTerminal(4242)).ok).toBe(true);
    expect(calls).toContain("dispose");
    expect((await vscode.sendText(999, "x")).ok).toBe(false);
  });
});
