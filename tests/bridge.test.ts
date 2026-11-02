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
const terminal = {
  name: "zsh",
  processId: Promise.resolve(4242),
  show: (preserveFocus: boolean) => calls.push(`show:${preserveFocus}`),
  sendText: (text: string, newLine: boolean) => calls.push(`send:${JSON.stringify(text)}:${newLine}`),
  dispose: () => calls.push("dispose"),
};
const fakeVscode = {
  window: { terminals: [terminal], state: { focused: true }, onDidOpenTerminal: noop, onDidCloseTerminal: noop, onDidChangeWindowState: noop },
  workspace: { workspaceFolders: [{ uri: { fsPath: join(home, "repo") } }], onDidChangeWorkspaceFolders: noop },
};

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (request: string, parent: unknown, isMain: boolean) {
  return request === "vscode" ? fakeVscode : realLoad.call(this, request, parent, isMain);
};

let stop: () => Promise<void> = async () => {};
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

  it("closes the terminal and refuses a terminal it does not own", async () => {
    expect((await vscode.closeTerminal(4242)).ok).toBe(true);
    expect(calls).toContain("dispose");
    expect((await vscode.sendText(999, "x")).ok).toBe(false);
  });
});
