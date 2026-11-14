// Sessions that run in Control Room, and their console, against a real tmux server of the test's own.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTarget, targetName } from "../shared/ides.ts";

const home = mkdtempSync(join(tmpdir(), "cr-home-"));
process.env.HOME = home;
process.env.CONTROL_ROOM_TMUX_SOCKET = `cr-test-${process.pid}`;

let hosted: typeof import("../server/hosted.ts");
let consoles: typeof import("../server/console.ts");
beforeAll(async () => {
  hosted = await import("../server/hosted.ts");
  consoles = await import("../server/console.ts");
});

describe("hosted sessions", () => {
  it("knows its own session names only", () => {
    expect(hosted.isHostedName("cr-0a1b2c3d")).toBe(true);
    for (const name of ["cr-0a1b2c3", "cr-0A1B2C3D", "work", "cr-0a1b2c3d;rm", 7, null]) expect(hosted.isHostedName(name)).toBe(false);
    expect(hosted.isHostedName("crt-0a1b2c3d")).toBe(true);
    expect(hosted.isTerminalName("crt-0a1b2c3d")).toBe(true);
    expect(hosted.isTerminalName("cr-0a1b2c3d")).toBe(false);
    expect(hosted.hostedName("cr-0a1b2c3d:@0.%0")).toBe("cr-0a1b2c3d");
    expect(hosted.hostedName("dev:@1.%3")).toBeNull();
    expect(hosted.hostedName(null)).toBeNull();
  });

  it("hands the first message to Claude Code as one argument, never to the shell", () => {
    const prompt = `fix "this"; rm -rf ~ $(whoami) \`id\``;
    const args = hosted.newSessionArgs("cr-0a1b2c3d", { cwd: "/repo", prompt, cols: 1000, rows: 2 }, "/bin/zsh");
    expect(args.slice(-6)).toEqual(["/bin/zsh", "-lic", 'claude "$@"', "claude", "--", prompt]);
    expect(args).toContain("new-session");
    expect(args[args.indexOf("-x") + 1]).toBe("400");
    expect(args[args.indexOf("-y") + 1]).toBe("10");
    expect(hosted.newSessionArgs("cr-0a1b2c3d", { cwd: "/repo", prompt: "-x" }).slice(-2)).toEqual(["--", "-x"]);
    expect(hosted.newSessionArgs("cr-0a1b2c3d", { cwd: "/repo", resume: "abc" }).slice(-2)).toEqual(["--resume", "abc"]);
    expect(hosted.newSessionArgs("cr-0a1b2c3d", { cwd: "/repo" }).at(-1)).toBe("claude");
    const tuned = hosted.newSessionArgs("cr-0a1b2c3d", { cwd: "/repo", prompt: "hi", model: "opus[1m]", effort: "high", mode: "plan" });
    expect(tuned.slice(tuned.indexOf("claude", tuned.indexOf("-lic") + 2))).toEqual(["claude", "--model", "opus[1m]", "--effort", "high", "--permission-mode", "plan", "--", "hi"]);
  });

  it("starts Claude Code on another account by its config folder, and on the usual one without", () => {
    const args = hosted.newSessionArgs("cr-0a1b2c3d", { cwd: "/repo", prompt: "hi", account: { label: "Personal", dir: "/Users/me/my claude" } }, "/bin/zsh");
    expect(args.slice(args.indexOf("/bin/zsh"))).toEqual(["/bin/zsh", "-lic", 'export CLAUDE_CONFIG_DIR="$1"; shift; claude "$@"', "claude", "/Users/me/my claude", "--", "hi"]);
    expect(hosted.newSessionArgs("cr-0a1b2c3d", { cwd: "/repo", prompt: "hi" }, "/bin/zsh").slice(-5)).toEqual(["-lic", 'claude "$@"', "claude", "--", "hi"]);
    // One that Control Room was started with stays out of every session.
    expect(hosted.sessionEnv({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/elsewhere" }).CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it("starts zsh with its history shared, so a terminal that runs for days still saves what it ran", () => {
    expect(hosted.shellArgs("/bin/zsh")).toEqual(["/bin/zsh", "-l", "-o", "SHARE_HISTORY"]);
    expect(hosted.shellArgs("/opt/homebrew/bin/bash")).toEqual(["/opt/homebrew/bin/bash", "-l"]);
  });

  it("starts Claude Code without the variables of whoever started Control Room", () => {
    const env = hosted.sessionEnv({
      PATH: "/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      ELECTRON_RUN_AS_NODE: "1",
      npm_lifecycle_event: "app",
      TMUX: "x",
      EDITOR: "vi",
      GIT_EDITOR: "true",
      HOME: "/h",
    });
    expect(env).toMatchObject({ PATH: "/bin", HOME: "/h", COLORTERM: "truecolor", LANG: "en_US.UTF-8" });
    for (const k of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "ELECTRON_RUN_AS_NODE", "npm_lifecycle_event", "TMUX", "EDITOR", "GIT_EDITOR"]) expect(env[k]).toBeUndefined();
    // An editor of your own stays: only the one a Claude Code tool runs with is left out.
    expect(hosted.sessionEnv({ PATH: "/bin", EDITOR: "nano", GIT_EDITOR: "code --wait" })).toMatchObject({ EDITOR: "nano", GIT_EDITOR: "code --wait" });
    expect(hosted.foreignNames("PATH=/bin\nEDITOR=vi\nGIT_EDITOR=true\n-VISUAL\nCLAUDE_PID=7\nHOME=/h\n")).toEqual(["EDITOR", "GIT_EDITOR", "CLAUDE_PID"]);
    expect(hosted.foreignNames("PATH=/bin\nEDITOR=nano\n")).toEqual([]);
  });

  it("refuses a folder that does not exist, and a resume id that is not one", async () => {
    expect((await hosted.startSession({ cwd: join(home, "nope") })).ok).toBe(false);
    expect((await hosted.startSession({ cwd: "relative/path" })).ok).toBe(false);
    expect((await hosted.startSession({ cwd: home, resume: "--mcp-config x" })).ok).toBe(false);
    expect((await hosted.startSession({ cwd: home, model: "opus --settings x" })).ok).toBe(false);
    expect((await hosted.startSession({ cwd: home, effort: "ultra" })).ok).toBe(false);
    expect((await hosted.startSession({ cwd: home, mode: "bypassPermissions" })).ok).toBe(false);
  });

  it("puts back the defaults that /model and /effort save, and nothing else", async () => {
    const { keepDefaults } = await import("../server/statusline.ts");
    const file = join(home, ".claude", "settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(file, JSON.stringify({ model: "opus", modelSettings: { "claude-opus-5-5": { effortLevel: "xhigh" } }, theme: "dark" }));
    const out = await keepDefaults(async () => {
      // What Claude Code writes when you pick Sonnet at high effort, plus a change of your own meanwhile.
      writeFileSync(file, JSON.stringify({ model: "sonnet", modelSettings: { "claude-opus-5-5": { effortLevel: "xhigh" }, "claude-sonnet-5-5": { effortLevel: "high" } }, effortLevel: "high", theme: "light" }));
      return "done";
    });
    expect(out).toBe("done");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ model: "opus", modelSettings: { "claude-opus-5-5": { effortLevel: "xhigh" } }, theme: "light" });
  });

  it("knows Claude Code asking to confirm a model or effort switch", async () => {
    const { ASKS_TO_SWITCH } = await import("../server/actions.ts");
    const ask = (title: string, yes: string) =>
      `❯ /x\n────\n  ${title}\n  Your next response will be slower and use more tokens\n  ❯ 1. Yes, ${yes}\n    2. No, go back\n`;
    expect(ASKS_TO_SWITCH.test(ask("Switch model?", "switch to Sonnet 5.5"))).toBe(true);
    expect(ASKS_TO_SWITCH.test(ask("Change effort level?", "switch to medium"))).toBe(true);
    // Another question, or No chosen, gets no Enter.
    expect(ASKS_TO_SWITCH.test(ask("Do you want to proceed?", "allow"))).toBe(false);
    expect(ASKS_TO_SWITCH.test("  Switch model?\n    1. Yes, switch to Sonnet 5.5\n  ❯ 2. No, go back\n")).toBe(false);
  });

  it("keeps a dropped card where it was dropped, until the session is used again", async () => {
    const order = await import("../server/order.ts");
    expect(order.sortKey("a", 5_000)).toBe(5_000);
    await order.place("a", 3_000, 1_000);
    const dropped = order.sortKey("a", 5_000);
    expect(dropped).toBe(2_000);
    expect(order.sortKey("a", Date.now() + 1_000)).toBeGreaterThan(dropped); // used after the drop: by its use again
    await order.place("b", 3_000, null);
    expect(order.sortKey("b", 0)).toBe(3_000 - 60_000);
    await order.place("c", null, 9_000);
    expect(order.sortKey("c", 0)).toBeGreaterThanOrEqual(Date.now() - 1_000);
    order.noteUsed("b");
    expect(order.usedAt("b")).toBeGreaterThan(0);
    await order.place("d", null, null); // waits for the write that also carries b's use
    const saved = JSON.parse(readFileSync(join(home, ".claude-control-room", "order.json"), "utf8"));
    expect(saved).toHaveProperty("placed.a.key", 2_000);
    expect(saved.used.b).toBe(order.usedAt("b"));
    expect(order.keyBetween(3_000, 1_000, 0)).toBe(2_000);
  });

  it("tells typing apart from what the terminal reports by itself", () => {
    for (const reports of ["\x1b[I", "\x1b[O", "\x1b[<0;12;4M\x1b[<0;12;4m", "\x1b[M !!"]) expect(consoles.isTyping(reports)).toBe(false);
    for (const typed of ["a", "\r", "\x1b", "\x1b[A", "\x1b[Ihi"]) expect(consoles.isTyping(typed)).toBe(true);
    expect(consoles.isTyping(7)).toBe(false);
  });

  it("finds your last message even when much tool output came after it", async () => {
    const { readTranscript } = await import("../server/transcript.ts");
    const file = join(home, "long.jsonl");
    const said = JSON.stringify({ type: "user", message: { content: "Fix the build" }, timestamp: "2026-11-04T10:00:00Z" });
    const noise = Array.from({ length: 150 }, (_, i) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(10_000) }] }, timestamp: `2026-11-04T10:0${Math.floor(i / 60)}:00Z` }));
    writeFileSync(file, [said, ...noise].join("\n") + "\n");
    expect((await readTranscript(file))?.lastPromptAt).toBe(Date.parse("2026-11-04T10:00:00Z"));
  });

  it("does not update a copy that was not built from a git checkout", async () => {
    const update = await import("../server/update.ts");
    expect(update.updateState().source).toBeNull();
    expect(update.startUpdate().ok).toBe(false);
    expect(update.updateState().phase).toBe("idle");
  });

  it("opens a session that runs here in its console", () => {
    const t = openTarget({ tmux: "cr-0a1b2c3d:@0.%0", ide: null, hosted: true }, "pycharm");
    expect(t).toEqual({ kind: "console" });
    expect(targetName(t)).toBe("console");
    expect(openTarget({ tmux: "dev:@0.%0", ide: null, hosted: false }, "pycharm")).toEqual({ kind: "tmux" });
  });
});

describe("console protocol", () => {
  it("undoes tmux's escaping, and leaves text alone", () => {
    const raw = Buffer.from("a\\033[1mb\\015\\012\\134c é", "utf8");
    expect(consoles.unescapeOutput(raw).toString("utf8")).toBe("a\x1b[1mb\r\n\\c é");
    expect(consoles.unescapeOutput(Buffer.from("end\\01", "utf8")).toString("utf8")).toBe("end\\01");
  });

  it("types keys as hex, so escape sequences and any text arrive unchanged", () => {
    expect(consoles.keyCommands("=cr-0a1b2c3d:", "é\x1b[A\r")).toEqual(["send-keys -t =cr-0a1b2c3d: -H c3 a9 1b 5b 41 0d"]);
    const long = consoles.keyCommands("=x:", "y".repeat(2500));
    expect(long).toHaveLength(3);
    expect(long.join(" ").match(/79/g)).toHaveLength(2500);
  });
});

const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].find((p) => existsSync(p));

describe.skipIf(!TMUX)("console on a real tmux", () => {
  const name = "cr-7e57c0de";
  const tmux = (...args: string[]) => execFileSync(TMUX!, ["-L", process.env.CONTROL_ROOM_TMUX_SOCKET!, "-f", "/dev/null", ...args], { encoding: "utf8" });
  afterAll(() => {
    try {
      tmux("kill-server");
    } catch {
      /* already gone */
    }
  });

  it("paints the screen, streams what the session writes, and carries keys and size", async () => {
    tmux("new-session", "-d", "-s", name, "-x", "80", "-y", "20", "sh", "-c", "printf 'ready\\n'; exec cat");
    await until(() => tmux("capture-pane", "-p", "-t", `=${name}:`).includes("ready"));
    expect([...((await hosted.hostedSessions()) ?? [])]).toEqual([name]);

    const events: import("../server/console.ts").ConsoleEvent[] = [];
    const off = consoles.watchConsole(name, 100, 24, (e) => events.push(e))!;
    await until(() => events.some((e) => e.type === "reset"));
    const reset = events.find((e) => e.type === "reset")!;
    expect(reset.type === "reset" && reset.data.toString("utf8")).toContain("ready");
    expect(tmux("display-message", "-p", "-t", `=${name}:`, "#{window_width}x#{window_height}").trim()).toBe("100x24");

    expect(consoles.typeInConsole(name, "héllo\r")).toBe(true);
    const seen = () => Buffer.concat(events.flatMap((e) => (e.type === "data" ? [e.data] : []))).toString("utf8");
    await until(() => (seen().match(/héllo/g) ?? []).length >= 2); // the terminal's echo, then cat's copy

    // A second window sets the size for both; the first one hears about it and follows.
    const second: import("../server/console.ts").ConsoleEvent[] = [];
    const offSecond = consoles.watchConsole(name, 90, 30, (e) => second.push(e))!;
    await until(() => second.some((e) => e.type === "reset"));
    const reset2 = second.find((e) => e.type === "reset")!;
    expect(reset2.type === "reset" && [reset2.cols, reset2.rows]).toEqual([90, 30]);
    expect(events).toContainEqual({ type: "size", cols: 90, rows: 30 });
    await until(() => tmux("display-message", "-p", "-t", `=${name}:`, "#{window_width}x#{window_height}").trim() === "90x30");
    offSecond();

    // A window that closes before its screen arrives never joins, so nothing is sent to it later.
    const early: string[] = [];
    consoles.watchConsole(name, 90, 30, (e) => early.push(e.type))!();
    consoles.typeInConsole(name, "x\r");
    await until(() => (seen().match(/x/g) ?? []).length >= 2);
    expect(early).toEqual([]);

    tmux("kill-session", "-t", `=${name}`);
    await until(() => events.some((e) => e.type === "exit"));
    off();
  });

  it("starts a terminal in the folder, shows its screen, and closes it", async () => {
    mkdirSync(join(home, ".claude-control-room"), { recursive: true });
    const dir = mkdtempSync(join(tmpdir(), "cr-term-"));
    const r = await hosted.startShell(dir, "/bin/sh");
    expect(r.ok).toBe(true);
    expect(hosted.isTerminalName(r.name!)).toBe(true);
    const pane = (await hosted.hostedPanes())!.find((p) => p.name === r.name)!;
    expect(pane.cwd).toBe(realpathSync(dir));
    expect(pane.command).toMatch(/^(sh|bash)$/); // macOS's sh is bash
    expect(pane.pid).toBeGreaterThan(0);

    expect(consoles.typeInConsole(r.name!, "echo hi-$((40+2))\r")).toBe(true);
    await until(() => tmux("capture-pane", "-p", "-t", `=${r.name}:`).includes("hi-42"));
    expect((await hosted.screenLines(r.name!, 3)).at(-2)).toBe("hi-42");

    expect(await consoles.stopConsole(r.name!)).toBe(true);
    expect((await hosted.hostedPanes())!.some((p) => p.name === r.name)).toBe(false);
  });

  it("gives a terminal your own keys and editor, not those the tmux server started with", async () => {
    // A server started from a Claude Code tool keeps its EDITOR=vi, which gives zsh vi keys: ⌃R finds no history.
    tmux("new-session", "-d", "-s", "keep", "sh", "-c", "exec cat");
    let name: string | undefined;
    try {
      tmux("set-environment", "-g", "EDITOR", "vi");
      tmux("set-environment", "-g", "GIT_EDITOR", "true");
      const r = await hosted.startShell(home, "/bin/zsh");
      expect(r.ok).toBe(true);
      name = r.name;
      expect(tmux("show-environment", "-g")).not.toMatch(/^(EDITOR|GIT_EDITOR)=/m);
      await until(() => tmux("capture-pane", "-p", "-t", `=${name}:`).trim().length > 0);
      consoles.typeInConsole(name!, 'echo "ed=[$EDITOR$GIT_EDITOR]"; bindkey "^R"\r');
      await until(() => tmux("capture-pane", "-p", "-t", `=${name}:`).includes("history-incremental-search-backward"));
      expect(tmux("capture-pane", "-p", "-t", `=${name}:`)).toContain("ed=[]");
    } finally {
      if (name) await consoles.stopConsole(name);
      tmux("set-environment", "-g", "-u", "EDITOR");
      tmux("set-environment", "-g", "-u", "GIT_EDITOR");
      tmux("kill-session", "-t", "=keep");
    }
  });

  it("ends a console at once when its session does not exist", async () => {
    const events: string[] = [];
    consoles.watchConsole("cr-00000000", 80, 24, (e) => events.push(e.type));
    await until(() => events.includes("exit"));
    expect(events).not.toContain("reset");
  });
});

async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("other Claude accounts", () => {
  const personal = { label: "Personal", dir: join(home, ".claude-personal") };
  const write = (file: string, data: unknown, mtime?: number) => {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify(data));
    if (mtime) utimesSync(file, mtime / 1000, mtime / 1000);
  };

  it("reads the sessions of every account, each marked with its account", async () => {
    const { homes } = await import("../server/homes.ts");
    const { readSessionFiles } = await import("../server/monitor.ts");
    write(join(home, ".claude", "sessions", "111.json"), { pid: 111, sessionId: "work-1", cwd: "/w", kind: "interactive", entrypoint: "cli" });
    write(join(personal.dir, "sessions", "222.json"), { pid: 222, sessionId: "home-1", cwd: "/h", kind: "interactive", entrypoint: "cli" });
    const files = await readSessionFiles(homes([personal]));
    expect(files.map((f) => [f.sessionId, f.account?.label ?? null]).sort()).toEqual([
      ["home-1", "Personal"],
      ["work-1", null],
    ]);
  });

  it("takes each account's usage from the newest report of its own sessions", async () => {
    const { homes } = await import("../server/homes.ts");
    const { latestUsages } = await import("../server/statusline.ts");
    const taps = join(home, ".claude-control-room", "statusline");
    const soon = Math.floor(Date.now() / 1000) + 3600;
    const tap = (id: string, transcript: string | null, five: number) => ({ session_id: id, transcript_path: transcript, rate_limits: { five_hour: { used_percentage: five, resets_at: soon } } });
    const now = Date.now();
    write(join(taps, "work-1.json"), tap("work-1", join(home, ".claude", "projects", "-w", "work-1.jsonl"), 40), now - 60_000);
    write(join(taps, "home-1.json"), tap("home-1", join(personal.dir, "projects", "-h", "home-1.jsonl"), 10), now - 30_000);
    // The newest report is from an account no longer in Settings: no account's.
    write(join(taps, "gone-1.json"), tap("gone-1", join(home, ".claude-old", "projects", "-g", "gone-1.jsonl"), 99), now);
    // A newer session that reports no limits, such as one on an Ollama model, leaves the account's as they were.
    write(join(taps, "work-2.json"), { session_id: "work-2", transcript_path: join(home, ".claude", "projects", "-w", "work-2.jsonl") }, now);
    const [work, mine] = await latestUsages(homes([personal]));
    expect(work.fiveHour?.usedPercent).toBe(40);
    expect(mine.fiveHour?.usedPercent).toBe(10);
  });

  it("connects every account's settings, keeps each one's own status line, and puts each one back", async () => {
    const { saveSettings } = await import("../server/config.ts");
    const { installStatusLine, uninstallStatusLine, statusLineState } = await import("../server/statusline.ts");
    const work = join(home, ".claude", "settings.json");
    const mine = join(personal.dir, "settings.json");
    const broken = { label: "Broken", dir: join(home, ".claude-broken") };
    writeFileSync(work, JSON.stringify({ theme: "dark" }));
    await saveSettings({ accounts: [broken, personal] });
    try {
      write(join(broken.dir, "settings.json"), {});
      writeFileSync(join(broken.dir, "settings.json"), "{ not json");
      write(mine, { statusLine: { type: "command", command: "echo mine" } });
      const out = await installStatusLine();
      // The file that does not parse stays as it is, and holds back neither of the others.
      expect(out.ok).toBe(false);
      expect(out.message).toContain(join(broken.dir, "settings.json"));
      expect(readFileSync(join(broken.dir, "settings.json"), "utf8")).toBe("{ not json");
      for (const dir of [join(home, ".claude"), personal.dir]) expect(await statusLineState(dir)).toEqual({ statusLine: "installed", hooks: true, links: true });
      // Each account's script shows that account's own status line.
      const tap = JSON.parse(readFileSync(mine, "utf8")).statusLine.command;
      expect(tap).not.toBe(JSON.parse(readFileSync(work, "utf8")).statusLine.command);
      expect(readFileSync(tap, "utf8")).toContain("echo mine");
      // And opens its links with a script of its own, ready to run.
      const links = JSON.parse(readFileSync(mine, "utf8")).env.BROWSER;
      expect(links).not.toBe(JSON.parse(readFileSync(work, "utf8")).env.BROWSER);
      execFileSync("test", ["-x", links]);
      // Settings copied over from the work account point at its links; connecting again points them at their own.
      write(mine, { ...JSON.parse(readFileSync(mine, "utf8")), env: { BROWSER: JSON.parse(readFileSync(work, "utf8")).env.BROWSER } });
      expect((await statusLineState(personal.dir)).links).toBe(false);
      await installStatusLine();
      expect(JSON.parse(readFileSync(mine, "utf8")).env.BROWSER).toBe(links);
      await uninstallStatusLine();
      expect(JSON.parse(readFileSync(work, "utf8"))).toEqual({ theme: "dark" });
      expect(JSON.parse(readFileSync(mine, "utf8"))).toEqual({ statusLine: { type: "command", command: "echo mine" } });
    } finally {
      await saveSettings({ accounts: [] });
    }
  });

  it("connects an account added later once the usual one is connected, and not before", async () => {
    const { installStatusLine, uninstallStatusLine, connectLikeUsual, statusLineState } = await import("../server/statusline.ts");
    const later = { account: { label: "Later", dir: join(home, ".claude-later") }, dir: join(home, ".claude-later") };
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ theme: "dark" }));
    expect(await connectLikeUsual(later)).toBe(false);
    expect(existsSync(join(later.dir, "settings.json"))).toBe(false);
    await installStatusLine();
    try {
      expect(await connectLikeUsual(later)).toBe(true);
      expect(await statusLineState(later.dir)).toEqual({ statusLine: "installed", hooks: true, links: true });
    } finally {
      await uninstallStatusLine();
    }
  });

  it("puts back an account's defaults even when it had no settings file before", async () => {
    const { keepDefaults } = await import("../server/statusline.ts");
    const fresh = join(home, ".claude-fresh");
    await keepDefaults(async () => write(join(fresh, "settings.json"), { model: "sonnet", theme: "light" }), fresh);
    expect(JSON.parse(readFileSync(join(fresh, "settings.json"), "utf8"))).toEqual({ theme: "light" });
  });

  it("runs claude for an account with its folder, and for the usual one without any", async () => {
    const { claudeEnv } = await import("../server/homes.ts");
    const { CHILD_ENV } = await import("../server/proc.ts");
    expect(claudeEnv(personal).CLAUDE_CONFIG_DIR).toBe(personal.dir);
    CHILD_ENV.CLAUDE_CONFIG_DIR = "/somewhere/else";
    try {
      expect(claudeEnv(null).CLAUDE_CONFIG_DIR).toBeUndefined();
    } finally {
      delete CHILD_ENV.CLAUDE_CONFIG_DIR;
    }
  });
});

describe("account links", () => {
  it("keeps an account's Chrome profile when claude can't be run, and follows it once it can", async () => {
    const { CHILD_ENV } = await import("../server/proc.ts");
    const { readAccount } = await import("../server/account.ts");
    const { linkPath } = await import("../server/statusline.ts");
    const chrome = join(home, "Library", "Application Support", "Google", "Chrome");
    mkdirSync(chrome, { recursive: true });
    writeFileSync(join(chrome, "Local State"), JSON.stringify({ profile: { info_cache: { "Profile 4": { user_name: "Me@Work.com" } } } }));
    const ref = { label: "Links", dir: join(home, ".claude-links") };
    const script = linkPath({ account: ref, dir: ref.dir });
    mkdirSync(join(home, ".claude-control-room"), { recursive: true });
    writeFileSync(script, "#!/bin/sh\nopen '-na' 'Google Chrome' '--args' '--profile-directory=Profile 4' \"$1\"\n");
    const bin = mkdtempSync(join(tmpdir(), "cr-bin-"));
    const path = CHILD_ENV.PATH;
    try {
      // The app started from Finder with no claude on its PATH: the account is unknown, not one without a profile.
      CHILD_ENV.PATH = "/usr/bin:/bin";
      expect((await readAccount(ref)).email).toBeNull();
      expect(readFileSync(script, "utf8")).toContain("--profile-directory=Profile 4");
      writeFileSync(join(bin, "claude"), `#!/bin/sh\necho '{"loggedIn":true,"email":"me@work.com"}'\n`, { mode: 0o755 });
      CHILD_ENV.PATH = `${bin}:/usr/bin:/bin`;
      expect((await readAccount(ref)).email).toBe("me@work.com");
      expect(readFileSync(script, "utf8")).toContain("'--profile-directory=Profile 4' \"$1\"");
      // Signed in to an account with no Chrome profile of its own: its links go to the default browser.
      writeFileSync(join(bin, "claude"), `#!/bin/sh\necho '{"loggedIn":true,"email":"other@home.com"}'\n`, { mode: 0o755 });
      await readAccount(ref);
      expect(readFileSync(script, "utf8")).not.toContain("--profile-directory");
    } finally {
      CHILD_ENV.PATH = path;
    }
  });
});

describe("ticket names", () => {
  it("names a story's session after haiku's short title, and keeps it on disk", async () => {
    const { CHILD_ENV, sleep } = await import("../server/proc.ts");
    const { ticketName } = await import("../server/summaries.ts");
    const bin = mkdtempSync(join(tmpdir(), "cr-bin-"));
    const calls = join(bin, "calls");
    writeFileSync(join(bin, "claude"), `#!/bin/sh\ncat >> "${calls}"\necho '{"is_error":false,"result":"{\\"title\\": \\"Logistics Truck Alerts\\"}"}'\n`, { mode: 0o755 });
    const story = { id: 27336, name: "1d | Truck alerts - BE: opt-in (recipients)", epic: "Logistics · Truck alerts (late, arrived)", state: null, url: "", type: null, owners: [] };
    const path = CHILD_ENV.PATH;
    try {
      CHILD_ENV.PATH = `${bin}:/usr/bin:/bin`;
      // AI summaries off: the story's own name, and haiku is never asked.
      expect(await ticketName({ ...story, id: 1 }, null)).toBe("1-Truck alerts - BE: opt-in");
      expect(existsSync(calls)).toBe(false);
      expect(await ticketName(story, { account: null })).toBe("27336-Truck alerts - BE: opt-in");
      let name = "";
      for (let i = 0; i < 50 && !name.endsWith("Alerts"); i++) {
        await sleep(100);
        name = await ticketName(story, { account: null });
      }
      expect(name).toBe("27336-Logistics Truck Alerts");
      expect(readFileSync(calls, "utf8")).toContain("Epic: Logistics · Truck alerts (late, arrived)");
      expect(JSON.parse(readFileSync(join(home, ".claude-control-room", "ticket-titles.json"), "utf8"))["27336"].title).toBe("Logistics Truck Alerts");
      expect(readFileSync(calls, "utf8").split("Story:").length - 1).toBe(1);
    } finally {
      CHILD_ENV.PATH = path;
    }
  });
});
