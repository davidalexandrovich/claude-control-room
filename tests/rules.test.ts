import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { deriveActivity, endsWithQuestion, type StatusFile } from "../server/activity.ts";
import { cleanSettings } from "../server/config.ts";
import { parseRemote, parseShortstat } from "../server/git.ts";
import { ideOf, openInIde } from "../server/ide.ts";
import { cleanName, MAX_NAME, pickName, tabName, type NameParts } from "../server/names.ts";
import { etimeSeconds, loginAgeFrom } from "../server/proc.ts";
import { bridgeIdOf, CLEAR_DRAFT, REMOTE_COMMAND, remoteRefusal, remoteUrl } from "../server/remote.ts";
import { summarizeChecks } from "../server/github.ts";
import { findStoryId } from "../server/shortcut.ts";
import { HOOK_BODY, tapScript, withConnection, withoutConnection } from "../server/statusline.ts";
import { HOOK_SCRIPT, TAP_SCRIPT } from "../server/paths.ts";
import { applyLines, describeTool, emptyState, modelName, userText } from "../server/transcript.ts";
import { verdictFor, type WorktreeFacts } from "../server/worktrees.ts";
import { isIdeId, openTarget, targetName } from "../shared/ides.ts";
import { fitWall, TILE_MIN_H, TILE_MIN_W } from "../web/src/lib/layout.ts";

const NOW = 1_800_000_000_000;
const file = (status: string, waitingFor: string | null = null, ago = 60_000): StatusFile => ({
  status,
  waitingFor,
  statusUpdatedAt: NOW - ago,
  updatedAt: NOW - ago,
  startedAt: NOW - 3_600_000,
});
const line = (o: object) => JSON.stringify(o);

describe("transcript", () => {
  it("keeps what a person typed and drops machine messages", () => {
    expect(userText({ message: { content: "Fix the login page" } })).toBe("Fix the login page");
    expect(userText({ message: { content: "<command-name>/effort</command-name><command-args>high</command-args>" } })).toBe("/effort high");
    expect(userText({ message: { content: "<local-command-stdout>done</local-command-stdout>" } })).toBeNull();
    expect(userText({ message: { content: "hi <system-reminder>secret</system-reminder>" } })).toBe("hi");
    expect(userText({ message: { content: [{ type: "tool_result", content: "x" }] } })).toBeNull();
    expect(userText({ message: { content: "[Request interrupted by user]" } })).toBe("⏹ Interrupted");
  });

  it("tracks titles, PR links, effort, model and unanswered tool calls", () => {
    const s = emptyState("/x.jsonl");
    applyLines(s, [
      line({ type: "user", message: { content: "Build the thing" }, timestamp: "2026-11-01T10:00:00Z", cwd: "/repo" }),
      line({ type: "system", subtype: "local_command", content: "<local-command-stdout>Set effort level to high</local-command-stdout>" }),
      line({ type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls", description: "List files" } }] } }),
      line({ type: "ai-title", aiTitle: "Thing builder" }),
      line({ type: "pr-link", prNumber: 12, prUrl: "https://github.com/o/r/pull/12", prRepository: "o/r" }),
      line({ type: "api-request", body: "x".repeat(50) }),
      "{ not json",
    ]);
    expect(s.aiTitle).toBe("Thing builder");
    expect(s.prLink?.number).toBe(12);
    expect(s.effort).toBe("high");
    expect(s.model).toBe("claude-opus-5-5");
    expect(s.pending.map((p) => p.id)).toEqual(["t1"]);
    expect(s.chat.map((c) => c.role)).toEqual(["user", "tool"]);
    expect(s.cwd).toBe("/repo");

    applyLines(s, [line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } })]);
    expect(s.pending).toEqual([]);
  });

  it("forgets a tool call the person abandoned by typing a new message", () => {
    const s = emptyState("/x.jsonl");
    applyLines(s, [
      line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Edit", input: {} }] } }),
      line({ type: "user", message: { content: "stop, do something else" } }),
    ]);
    expect(s.pending).toEqual([]);
  });

  it("describes tools in plain words", () => {
    expect(describeTool("Bash", { command: "pytest -q", description: "Run the tests" })).toMatchObject({ action: "Run a command", detail: "Run the tests" });
    expect(describeTool("Edit", { file_path: "/a/b/c/file.ts" }).detail).toBe("c/file.ts");
    expect(describeTool("mcp__claude_ai_Shortcut__get_story", {}).action).toBe("Use Shortcut");
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelName("claude-fable-5")).toBe("Fable 5");
  });
});

describe("status", () => {
  const inactiveAfter = 2 * 3_600_000;

  it("names each state the way a person would", () => {
    expect(deriveActivity(file("busy"), null, NOW, inactiveAfter).label).toBe("Working");
    expect(deriveActivity(file("shell"), null, NOW, inactiveAfter).kind).toBe("background");
    expect(deriveActivity(file("idle", null, 10 * 60_000), null, NOW, inactiveAfter).kind).toBe("idle");
    expect(deriveActivity(file("idle", null, 5 * 3_600_000), null, NOW, inactiveAfter).kind).toBe("inactive");
  });

  it("takes an approval's details from the hook, not from an older transcript call", () => {
    const t = emptyState("/x.jsonl");
    applyLines(t, [line({ type: "assistant", message: { content: [{ type: "tool_use", id: "old", name: "Read", input: { file_path: "/a" } }] } })]);
    const ask = { at: NOW - 30_000, toolName: "Bash", toolInput: { command: "git push", description: "Push the branch" }, effort: "high" };
    const a = deriveActivity(file("waiting", "permission prompt"), t, NOW, inactiveAfter, ask);
    expect(a.kind).toBe("approval");
    expect(a.tool).toMatchObject({ tool: "Bash", detail: "Push the branch" });
  });

  it("ignores a hook record left from an earlier prompt", () => {
    const stale = { at: NOW - 10 * 60_000, toolName: "Bash", toolInput: { command: "rm -rf build" }, effort: null };
    const a = deriveActivity(file("waiting", "permission prompt", 60_000), null, NOW, inactiveAfter, stale);
    expect(a.tool).toBeNull();
  });

  it("reads a question and its options from the hook", () => {
    const ask = {
      at: NOW,
      toolName: "AskUserQuestion",
      toolInput: { questions: [{ question: "Tea or coffee?", header: "Drink", options: [{ label: "Tea" }, { label: "Coffee" }], multiSelect: false }] },
      effort: null,
    };
    const a = deriveActivity(file("waiting", "input needed"), null, NOW, inactiveAfter, ask);
    expect(a.kind).toBe("question");
    expect(a.question?.options.map((o) => o.label)).toEqual(["Tea", "Coffee"]);
  });

  it("notices a reply that ends by asking the person", () => {
    expect(endsWithQuestion("All done. Should I open the PR?")).toBe(true);
    expect(endsWithQuestion("Want me to merge it now")).toBe(true);
    expect(endsWithQuestion("The PR is merged.")).toBe(false);
    expect(endsWithQuestion("Done. Is there anything else you'd like me to do?")).toBe(false);
  });
});

describe("worktree advice", () => {
  const clean: WorktreeFacts = { dirty: 0, unpushed: 0, unpushedKnown: true, headInPr: true, lastCommitAt: null };
  const base = { isMain: false, exists: true, liveSessions: 0, facts: clean, pr: null };

  it("never offers the main checkout or a folder in use", () => {
    expect(verdictFor({ ...base, isMain: true }).verdict).toBe("main");
    expect(verdictFor({ ...base, liveSessions: 1 }).verdict).toBe("in-use");
  });

  it("keeps unsaved work", () => {
    expect(verdictFor({ ...base, facts: { ...clean, dirty: 3 } }).verdict).toBe("keep");
    expect(verdictFor({ ...base, facts: { ...clean, unpushed: 2, headInPr: false } }).verdict).toBe("keep");
    expect(verdictFor({ ...base, facts: { ...clean, unpushedKnown: false } }).verdict).toBe("keep");
  });

  it("keeps a folder whose PR is still open", () => {
    expect(verdictFor({ ...base, pr: { number: 5, state: "OPEN" } }).verdict).toBe("keep");
  });

  it("calls a squash-merged branch safe when the PR holds HEAD", () => {
    const v = verdictFor({ ...base, facts: { ...clean, unpushed: 4, headInPr: true }, pr: { number: 9, state: "MERGED" } });
    expect(v.verdict).toBe("safe");
  });

  it("does not call it safe when commits came after the merged PR", () => {
    const v = verdictFor({ ...base, facts: { ...clean, unpushed: 1, headInPr: false }, pr: { number: 9, state: "MERGED" } });
    expect(v.verdict).toBe("keep");
  });

  it("says probably safe when everything is pushed but no PR exists", () => {
    expect(verdictFor(base).verdict).toBe("probably-safe");
    expect(verdictFor({ ...base, exists: false }).verdict).toBe("gone");
  });
});

describe("Claude Code settings merge", () => {
  const theirs = {
    permissions: { allow: ["Bash(ls)"] },
    hooks: { PermissionRequest: [{ matcher: "Bash", hooks: [{ type: "command", command: "/their/hook.sh" }] }], Stop: [{ hooks: [] }] },
    statusLine: { type: "command", command: "/their/line.sh" },
  };

  it("adds our status line and hook and keeps everything else", () => {
    const next = withConnection(theirs);
    expect(next.permissions).toEqual(theirs.permissions);
    expect(next.statusLine?.command).toBe(TAP_SCRIPT);
    expect(next.hooks?.PermissionRequest).toHaveLength(2);
    expect(next.hooks?.PermissionRequest?.[0].hooks?.[0].command).toBe("/their/hook.sh");
    expect(next.hooks?.PermissionRequest?.[1].hooks?.[0]).toMatchObject({ command: HOOK_SCRIPT, async: true });
    expect(next.hooks?.Stop).toEqual(theirs.hooks.Stop);
    expect(withConnection(next).hooks?.PermissionRequest).toHaveLength(2);
  });

  it("takes ours out and gives back theirs", () => {
    const back = withoutConnection(withConnection(theirs), theirs.statusLine);
    expect(back).toEqual(theirs);
    const bare = withoutConnection(withConnection({ model: "opus" }), null);
    expect(bare).toEqual({ model: "opus" });
  });

  it("keeps the person's own status line running inside ours", () => {
    expect(tapScript("/their/line.sh")).toContain(`printf '%s' "$input" | /their/line.sh`);
    expect(tapScript(null)).toContain("rate_limits.five_hour");
    expect(HOOK_BODY).toContain("exit 0");
  });
});

describe("small parsers", () => {
  it("finds the story id in order of trust", () => {
    expect(findStoryId(["feature/sc-12345-login", "sc-999"])).toBe(12345);
    expect(findStoryId([null, "see https://app.shortcut.com/acme/story/4567/x and sc-4567 and sc-1111"])).toBe(4567);
    expect(findStoryId(["no story here"])).toBeNull();
  });

  it("reads git and GitHub output", () => {
    expect(parseRemote("git@github.com:acme/storefront.git")).toEqual({ owner: "acme", name: "storefront" });
    expect(parseRemote("https://github.com/o/r")).toEqual({ owner: "o", name: "r" });
    expect(parseShortstat(" 3 files changed, 120 insertions(+), 4 deletions(-)")).toEqual({ insertions: 120, deletions: 4 });
    expect(summarizeChecks([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "IN_PROGRESS" }]).state).toBe("pending");
    expect(summarizeChecks([{ status: "COMPLETED", conclusion: "FAILURE" }]).state).toBe("failing");
    expect(summarizeChecks([]).state).toBe("none");
  });
});

describe("wall layout", () => {
  it("fits fourteen sessions on a large display without scrolling", () => {
    const l = fitWall(14, 2500, 1100, 14);
    expect(l.scroll).toBe(false);
    expect(l.cols * l.rows).toBeGreaterThanOrEqual(14);
    expect(l.tileW).toBeGreaterThanOrEqual(TILE_MIN_W);
    expect(l.tileH).toBeGreaterThanOrEqual(TILE_MIN_H);
  });

  it("gives a single session a big but bounded screen", () => {
    const l = fitWall(1, 2500, 1100, 14);
    expect(l.cols).toBe(1);
    expect(l.tileW).toBeLessThanOrEqual(820);
  });

  it("scrolls instead of shrinking tiles below a readable size", () => {
    const l = fitWall(40, 1200, 600, 14);
    expect(l.scroll).toBe(true);
    expect(l.tileW).toBeGreaterThanOrEqual(TILE_MIN_W);
  });
});

describe("start at login", () => {
  it("reads ps elapsed times", () => {
    expect(etimeSeconds("05:09")).toBe(309);
    expect(etimeSeconds("02:05:09")).toBe(7509);
    expect(etimeSeconds("08-04:21:36")).toBe(8 * 86_400 + 4 * 3_600 + 21 * 60 + 36);
    expect(etimeSeconds("soon")).toBeNull();
  });

  it("dates the login by its oldest agent, so a restarted Dock does not look like a new login", () => {
    const ps = [
      "   00:42 /System/Library/CoreServices/Dock.app/Contents/MacOS/Dock",
      "02:10:00 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
      "   01:00 /Applications/Control Room.app/Contents/MacOS/Control Room",
    ].join("\n");
    expect(loginAgeFrom(ps)).toBe(7800);
    expect(loginAgeFrom("   00:40 /System/Library/CoreServices/Finder.app/Contents/MacOS/Finder")).toBe(40);
    expect(loginAgeFrom("   00:40 /usr/bin/ssh-agent")).toBeNull();
  });
});

describe("remote control", () => {
  it("reads the id Claude Code keeps while Remote Control is on, and links to it", () => {
    expect(bridgeIdOf("session_01AbCdEfGhJkMnPqRsTuVw")).toBe("session_01AbCdEfGhJkMnPqRsTuVw");
    expect(remoteUrl(bridgeIdOf("session_01AbCdEfGhJkMnPqRsTuVw"))).toBe("https://claude.ai/code/session_01AbCdEfGhJkMnPqRsTuVw");
    for (const raw of [undefined, null, 42, "", "cse_013by", "session_../x", "https://evil.example/session_1"]) expect(bridgeIdOf(raw)).toBeNull();
    expect(remoteUrl(null)).toBeNull();
  });

  it("never types into a session that is asking you something", () => {
    expect(remoteRefusal({ status: "waiting" })).toMatch(/Answer the session first/);
    expect(remoteRefusal(null)).toMatch(/gone/);
    for (const status of ["idle", "busy", "shell", null]) expect(remoteRefusal({ status })).toBeNull();
  });

  it("clears a draft with line keys only, then types the command with a space", () => {
    // Ctrl+C would stop a busy turn and Esc Esc would open the rewind menu, so neither may be sent.
    expect(CLEAR_DRAFT.map(([text]) => text).join("")).toMatch(/^\u0005\u0015+$/);
    expect(CLEAR_DRAFT.map(([, key]) => key)).toEqual(["C-e", "C-u", "C-u", "C-u", "C-u", "C-u", "C-u"]);
    expect(REMOTE_COMMAND).toBe("/remote-control ");
  });
});

describe("session names", () => {
  it("takes a VS Code tab's name only when a person gave it", () => {
    for (const name of ["Checkout tests", "Review #812", "Search & filters | Regression tests", "Dark mode 2"]) expect(tabName(name)).toBe(name);
    // The shell, the program, a version or Claude Code's own title say nothing about the work.
    for (const raw of ["zsh", "bash", "node", "claude", "Claude Code", "2.1.310", "✳ Fix the login page", "◐ Fix the login page", "", "   ", null, undefined, 42]) {
      expect(tabName(raw)).toBeNull();
    }
  });

  it("keeps a typed name on one line, without control characters, and not too long", () => {
    expect(cleanName("  Dark\nmode\t ")).toBe("Dark mode");
    expect(cleanName("a\u0007\u001b[31mb")).toBe("a [31mb");
    expect(cleanName("Тест · 測試 · 🚀")).toBe("Тест · 測試 · 🚀");
    expect([...cleanName("🚀".repeat(MAX_NAME + 5))!].length).toBe(MAX_NAME);
    for (const raw of ["", " \n ", null, 7, {}]) expect(cleanName(raw)).toBeNull();
  });

  it("puts the tab's name first, then the names Claude Code knows", () => {
    const parts: NameParts = { tab: "Dark mode 2", custom: "Settings | P6", title: "Dark theme for Settings", story: "Dark mode", headline: "Adding a dark theme", branch: "sc-1-dark-mode", folder: "repo" };
    expect(pickName(parts)).toEqual(["Dark mode 2", "tab"]);
    expect(pickName({ ...parts, tab: null })).toEqual(["Settings | P6", "custom"]);
    expect(pickName({ ...parts, tab: null, custom: null })).toEqual(["Dark theme for Settings", "title"]);
    expect(pickName({ ...parts, tab: null, custom: null, title: null })).toEqual(["Dark mode", "story"]);
    // A branch or folder name says little, so the plain-English headline goes before it.
    expect(pickName({ ...parts, tab: null, custom: null, title: null, story: null })).toEqual(["Adding a dark theme", "summary"]);
    expect(pickName({ ...parts, tab: null, custom: null, title: null, story: null, headline: null })).toEqual(["sc-1-dark-mode", "branch"]);
    expect(pickName({ tab: null, custom: null, title: null, story: null, headline: null, branch: null, folder: "repo" })).toEqual(["repo", "folder"]);
  });
});

describe("Open in", () => {
  it("tells the IDE from the process that hosts the terminal", () => {
    const app = (path: string) => `/Applications/${path}`;
    expect(ideOf(app("Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)"))).toBe("vscode");
    expect(ideOf(app("Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)"))).toBe("cursor");
    expect(ideOf(app("PyCharm CE.app/Contents/MacOS/pycharm"))).toBe("pycharm");
    expect(ideOf(app("IntelliJ IDEA.app/Contents/MacOS/idea"))).toBe("intellij");
    expect(ideOf(app("WebStorm.app/Contents/MacOS/webstorm"))).toBe("webstorm");
    expect(ideOf(app("Zed.app/Contents/MacOS/zed"))).toBe("zed");
    for (const comm of ["/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal", "tmux", "/bin/zsh", "-zsh"]) expect(ideOf(comm)).toBeNull();
  });

  it("keeps only IDEs it knows, also in a saved config.json", () => {
    expect(isIdeId("pycharm")).toBe(true);
    for (const v of ["notepad", "", null, 3]) expect(isIdeId(v)).toBe(false);
    expect(cleanSettings({ ide: "goland" as never }).ide).toBe("vscode");
    expect(cleanSettings({ ide: "zed" }).ide).toBe("zed");
  });

  it("opens a session in its own IDE, and uses the Settings choice only outside one", () => {
    expect(openTarget({ tmux: "work:1.0", ide: null }, "pycharm")).toEqual({ kind: "tmux" });
    expect(openTarget({ tmux: null, ide: "pycharm" }, "vscode")).toEqual({ kind: "ide", ide: "pycharm" });
    expect(openTarget({ tmux: null, ide: null }, "zed")).toEqual({ kind: "ide", ide: "zed" });
    expect(targetName({ kind: "tmux" })).toBe("Terminal");
    expect(targetName({ kind: "ide", ide: "intellij" })).toBe("IntelliJ IDEA");
  });

  it("refuses a missing folder, and a folder outside git in a JetBrains IDE", async () => {
    expect(await openInIde("vscode", "/no/such/folder", true)).toEqual({ ok: false, message: "That folder is gone: /no/such/folder" });
    const r = await openInIde("pycharm", tmpdir(), false);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("only git repos");
  });
});
