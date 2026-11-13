import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveActivity, endsWithQuestion, type StatusFile } from "../server/activity.ts";
import { accountDir, cleanAccounts, cleanSettings, folderSetting } from "../server/config.ts";
import { homeOf, homes } from "../server/homes.ts";
import { parseRemote, parseShortstat, workingGit } from "../server/git.ts";
import { chosenIde, ideOf, openInIde } from "../server/ide.ts";
import { cleanName, MAX_NAME, pickName, tabName, type NameParts } from "../server/names.ts";
import { BROWSER_BODY, signInUrl } from "../server/account.ts";
import { etimeSeconds, loginAgeFrom, loginShellPath, mergePath } from "../server/proc.ts";
import { bridgeIdOf, CLEAR_DRAFT, REMOTE_COMMAND, remoteRefusal, remoteUrl } from "../server/remote.ts";
import { openSince, type PrRow, summarizeChecks } from "../server/github.ts";
import { findStoryId } from "../server/shortcut.ts";
import { HOOK_BODY, tapScript, withConnection, withoutConnection } from "../server/statusline.ts";
import { APP_DIR, HOOK_SCRIPT, TAP_SCRIPT } from "../server/paths.ts";
import { linkScript, profileOf, profilesByEmail } from "../server/chrome.ts";
import { parseTicketTitle, plainTicketTitle } from "../server/summaries.ts";
import { cleanPrompts, fillSlots, MAX_PROMPTS, pickPrompt, promptSlots, promptText, promptTitle, promptTune, withPrompt } from "../shared/prompts.ts";
import { applyLines, describeTool, emptyState, modelName, readTranscript, userText } from "../server/transcript.ts";
import { verdictFor, worksIn, type WorktreeFacts } from "../server/worktrees.ts";
import { claudeCommand, isEffort, isMode, isModel, modeName, modelAlias } from "../shared/claude.ts";
import { isIdeId, openTarget, targetName } from "../shared/ides.ts";
import { commandOf, KEY_GROUPS, KEYS, sessionKeyOf } from "../web/src/lib/keys.ts";
import { fitWall, TILE_MIN_H, TILE_MIN_W } from "../web/src/lib/layout.ts";
import { allHidden, cardColumns, dragGap } from "../web/src/lib/cards.ts";

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

  it("knows which branches the session itself worked on", () => {
    const s = emptyState("/x.jsonl");
    const bash = (command: string, gitBranch: string) =>
      line({ type: "assistant", gitBranch, message: { content: [{ type: "tool_use", id: command, name: "Bash", input: { command } }] } });
    applyLines(s, [
      bash("git status && git log -3", "26012_old_work"),
      bash("git switch -c 27001_new && git commit -am wip", "main"),
      line({ type: "user", gitBranch: "27002_fix", message: { content: "<bash-input>git push -u origin 27002_fix</bash-input>" } }),
      bash("gh pr view 1450", "26012_old_work"),
    ]);
    // Looking at a branch is not working on it; a commit after `switch -c` lands on the new branch.
    expect(s.workedBranches).toEqual(["27001_new", "27002_fix"]);
  });

  it("puts work done after a cd in that folder, not on the session's branch", () => {
    const s = emptyState("/x.jsonl");
    const bash = (command: string) =>
      line({ type: "assistant", cwd: "/code/shield", gitBranch: "26012_shared", message: { content: [{ type: "tool_use", id: command, name: "Bash", input: { command } }] } });
    applyLines(s, [
      line({ type: "user", cwd: "/code/shield", gitBranch: "26012_shared", message: { content: "<bash-input>cd ~/code/shield-26900 && git add x && git commit -m y && git push</bash-input>" } }),
      bash("cd ../shield-27100 && git switch -c 27100_new"),
      bash('git -C "/code/other repo" push'),
      bash("cd /tmp && ls"),
    ]);
    expect(s.workedBranches).toEqual([]);
    expect(s.workedFolders).toEqual([`${homedir()}/code/shield-26900`, "/code/shield-27100", "/code/other repo"]);
  });

  it("follows the session to the folders it works in, the latest last", () => {
    const s = emptyState("/x.jsonl");
    const use = (name: string, input: object) =>
      line({ type: "assistant", cwd: "/code/shield", message: { content: [{ type: "tool_use", id: JSON.stringify(input), name, input }] } });
    applyLines(s, [
      use("Bash", { command: "git -C ~/code/shield fetch origin main && git -C ~/code/shield worktree add -b 27336_alerts ../shield-27336 origin/main" }),
      use("Bash", { command: "cd ~/code/shield-27100 && git status" }),
      use("Read", { file_path: "/code/shield/.env" }),
      use("Bash", { command: "ls -la" }),
      use("Bash", { command: "cd ~/Library/Application\\ Support/x && ls" }),
      use("Edit", { file_path: "/code/shield-27336/schemas/alert.py", old_string: "a", new_string: "b" }),
    ]);
    // A worktree is added where its path says, beside the folder after -C; reading a file is not working there.
    expect(s.recentFolders).toEqual([
      `${homedir()}/code/shield-27336`,
      `${homedir()}/code/shield-27100`,
      `${homedir()}/Library/Application Support/x`,
      "/code/shield-27336/schemas",
    ]);
    expect(s.workedBranches).toEqual([]);
  });

  it("finds branch work and published pages from before the stretch it reads first", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "cr-tx-")), "s.jsonl");
    const chat = (i: number) => line({ type: "assistant", cwd: "/code/shield", message: { content: [{ type: "text", text: `step ${i} ${"x".repeat(30_000)}` }] } });
    writeFileSync(
      file,
      [
        line({ type: "user", cwd: "/code/shield", gitBranch: "26012_shared", message: { content: "<bash-input>cd ../shield-26900 && git push</bash-input>" } }),
        line({ type: "assistant", cwd: "/code/shield", message: { content: [{ type: "tool_use", id: "c", name: "Bash", input: { command: "cd ../shield-27336 && ls" } }] } }),
        line({ type: "assistant", cwd: "/code/shield", isSidechain: true, message: { content: [{ type: "tool_use", id: "d", name: "Bash", input: { command: "cd ../shield-99999 && ls" } }] } }),
        line({ type: "assistant", cwd: "/code/shield", gitBranch: "27001_mine", message: { content: [{ type: "tool_use", id: "a", name: "Bash", input: { command: "git commit -am fix" } }] } }),
        line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "p", content: "Published" }] }, toolUseResult: { url: "https://claude.ai/artifact/Early1", artifact_id: "x", title: "Early page" } }),
        ...Array.from({ length: 150 }, (_, i) => chat(i)),
      ].join("\n") + "\n",
    );
    const s = await readTranscript(file);
    expect(s?.chat.some((c) => c.text.startsWith("! cd"))).toBe(false); // outside what it read
    expect(s?.workedFolders).toEqual(["/code/shield-26900"]);
    expect(s?.recentFolders).toEqual(["/code/shield-27336"]); // a subagent's cd is its own
    expect(s?.workedBranches).toEqual(["27001_mine"]);
    expect(s?.artifacts).toEqual([{ url: "https://claude.ai/artifact/Early1", title: "Early page" }]);
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

  it("lists the pages it published with the Artifact tool, the latest last, and not ones it only read", () => {
    const s = emptyState("/x.jsonl");
    const published = (url: string, title: string) => ({ url, path: "/tmp/page.html", artifact_id: "58d63899-21b9-4d26-9cd6-e6b4c47ca713", title, updated: true });
    const result = (toolUseResult: unknown) => line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: "Published" }] }, toolUseResult });
    applyLines(s, [
      result(published("https://claude.ai/artifact/AAA111", "Grooming prep")),
      result(published("https://claude.ai/code/artifact/0b9e-42", "Triage")),
      result({ read: "<html>", artifactRead: true, owned: true }),
      result(published("javascript:alert(1)", "Not a page")),
      line({ type: "user", isSidechain: true, message: { content: [] }, toolUseResult: published("https://claude.ai/artifact/SUB", "A subagent's") }),
      result(published("https://claude.ai/artifact/AAA111", "Grooming prep, v2")),
    ]);
    expect(s.artifacts).toEqual([
      { url: "https://claude.ai/code/artifact/0b9e-42", title: "Triage" },
      { url: "https://claude.ai/artifact/AAA111", title: "Grooming prep, v2" },
    ]);
  });

  it("knows when you last sent a message, and not when a tool answered", () => {
    const s = emptyState("/x.jsonl");
    applyLines(s, [
      line({ type: "user", message: { content: "Go" }, timestamp: "2026-11-01T10:00:00Z" }),
      line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] }, timestamp: "2026-11-01T10:09:00Z" }),
      line({ type: "user", isMeta: true, message: { content: "Caveat" }, timestamp: "2026-11-01T10:10:00Z" }),
      // Claude Code's own summary when it compacts is written as a user message.
      line({ type: "user", isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { content: "This session is being continued" }, timestamp: "2026-11-01T10:20:00Z" }),
    ]);
    expect(s.lastPromptAt).toBe(Date.parse("2026-11-01T10:00:00Z"));
  });

  it("knows the permission mode of the last message", () => {
    const s = emptyState("/x.jsonl");
    applyLines(s, [line({ type: "permission-mode", permissionMode: "plan" })]);
    expect([s.mode, s.modeAt]).toEqual(["plan", null]);
    applyLines(s, [
      line({ type: "user", permissionMode: "auto", message: { content: "Go" }, timestamp: "2026-11-01T10:00:00Z" }),
      line({ type: "user", isSidechain: true, permissionMode: "manual", message: { content: "agent" }, timestamp: "2026-11-01T10:05:00Z" }),
    ]);
    expect([s.mode, s.modeAt]).toEqual(["auto", Date.parse("2026-11-01T10:00:00Z")]);
  });
});

describe("model, effort and mode", () => {
  it("lets through only real choices, so nothing else reaches Claude Code's command line", () => {
    for (const m of ["opus", "opus[1m]", "claude-opus-5-5", "claude-opus-5-5[1m]", "sonnet"]) expect(isModel(m)).toBe(true);
    for (const m of ["", "--dangerously-skip-permissions", "opus; rm -rf ~", "Opus", "opus[2m]", 3]) expect(isModel(m)).toBe(false);
    expect(isEffort("xhigh")).toBe(true);
    expect(isEffort("ultra")).toBe(false);
    expect(isMode("acceptEdits")).toBe(true);
    expect(isMode("bypassPermissions")).toBe(false);
  });

  it("names a model and a mode the way Claude Code shows them", () => {
    expect(modelAlias("claude-opus-5-5")).toBe("opus");
    expect(modelAlias("claude-opus-5-5[1m]")).toBe("opus[1m]");
    expect(modelAlias("claude-fable-5-1")).toBe("fable");
    expect(modelAlias("gpt-5")).toBeNull();
    expect(modeName("acceptEdits")).toBe("accept edits");
    expect(modeName("default")).toBe("manual");
    expect(modeName(null)).toBeNull();
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

describe("the checkout a session works in", () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "ignore" });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cr-wt-")));
  const repo = join(root, "shield");
  const other = join(root, "k8s");
  for (const dir of [repo, other]) {
    mkdirSync(dir);
    sh(dir, "init", "-q", "-b", "26012_old_work");
    sh(dir, "commit", "-q", "--allow-empty", "-m", "x");
  }
  sh(repo, "worktree", "add", "-q", "-b", "27336_alerts", join(root, "shield-27336"));
  mkdirSync(join(root, "plain"));

  it("is the worktree it went on to work in, not the shared checkout it started in", async () => {
    const git = await workingGit(repo, [join(root, "shield-27336"), join(root, "plain")], 0);
    expect(git?.branch).toBe("27336_alerts");
    expect(git?.isWorktree).toBe(true);
  });

  it("stays in its own folder after a look into another repo or a folder that is gone", async () => {
    expect((await workingGit(repo, [join(root, "k8s"), join(root, "shield-gone")], 0))?.branch).toBe("26012_old_work");
    // A trip back to the main checkout, to run its tools, does not take it off its worktree.
    expect((await workingGit(repo, [join(root, "shield-27336"), repo], 0))?.branch).toBe("27336_alerts");
    expect((await workingGit(join(root, "shield-27336"), [repo], 0))?.branch).toBe("27336_alerts");
    expect((await workingGit(repo, [], 0))?.root).toBe(repo);
  });

  it("counts a session as in a worktree it works in, though it started elsewhere", () => {
    const wt = join(root, "shield-27336");
    expect(worksIn({ cwd: repo, git: { root: wt } }, wt)).toBe(true);
    expect(worksIn({ cwd: repo, git: { root: repo } }, wt)).toBe(false);
    expect(worksIn({ cwd: join(wt, "server"), git: null }, wt)).toBe(true);
  });

  it("never offers to delete a worktree the session only went on to work in", async () => {
    const { worktreeReportFor } = await import("../server/actions.ts");
    const wt = join(root, "shield-27336");
    const s = { pid: 1, cwd: repo, git: { root: wt, mainRoot: repo, isWorktree: true, branch: "27336_alerts", remote: null } };
    expect(await worktreeReportFor({} as never, s as never)).toBeNull();
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

  it("adds our link opener as $BROWSER, and leaves one the person set alone", () => {
    const ours = join(APP_DIR, "open-link.sh");
    const next = withConnection({ ...theirs, env: { FOO: "1" } });
    expect(next.env).toEqual({ FOO: "1", BROWSER: ours });
    expect(withConnection(next, TAP_SCRIPT, join(APP_DIR, "open-link-abc.sh")).env?.BROWSER).toBe(join(APP_DIR, "open-link-abc.sh"));
    expect(withoutConnection(next, theirs.statusLine).env).toEqual({ FOO: "1" });
    const own = withConnection({ env: { BROWSER: "/their/browser.sh" } });
    expect(own.env).toEqual({ BROWSER: "/their/browser.sh" });
    expect(withoutConnection(own, null).env).toEqual({ BROWSER: "/their/browser.sh" });
  });

  it("finds the Chrome profile signed in to an email", () => {
    const state = JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: "Dvir", user_name: "Me@Gmail.com" },
          "Profile 1": { name: "Work", user_name: "" },
          "Profile 4": { name: "Dvir SOJO", user_name: "me@work.com" },
          "Bad'; rm -rf ~": { user_name: "evil@x.com" },
        },
      },
    });
    const map = profilesByEmail(state)!;
    expect(profileOf(map, "me@gmail.com")).toBe("Default");
    expect(profileOf(map, " ME@work.com")).toBe("Profile 4");
    expect(profileOf(map, "evil@x.com")).toBeNull();
    expect(profileOf(map, null)).toBeNull();
    expect(map.size).toBe(2);
    // Half written, or not Chrome's: unknown, so a script that works is left as it is.
    expect(profilesByEmail('{"profile":')).toBeNull();
    expect(profilesByEmail("{}")).toBeNull();
  });

  it("opens links in the account's Chrome profile, and hands a sign-in link to Control Room", () => {
    const work = linkScript("Profile 4");
    expect(work).toContain(`open '-na' 'Google Chrome' '--args' '--profile-directory=Profile 4' "$1" 2>/dev/null || open "$1"`);
    expect(linkScript(null)).toMatch(/\nopen "\$1"\n$/);
    const dir = mkdtempSync(join(tmpdir(), "cr-link-"));
    const script = join(dir, "open-link.sh");
    const out = join(dir, "signin.url");
    writeFileSync(script, work);
    execFileSync("/bin/sh", [script, "https://claude.ai/oauth/x"], { env: { ...process.env, CONTROL_ROOM_SIGNIN: out } });
    expect(readFileSync(out, "utf8")).toBe("https://claude.ai/oauth/x\n");
  });

  it("keeps the person's own status line running inside ours", () => {
    expect(tapScript("/their/line.sh")).toContain(`printf '%s' "$input" | /their/line.sh`);
    expect(tapScript(null)).toContain("rate_limits.five_hour");
    expect(HOOK_BODY).toContain("exit 0");
  });
});

describe("saved prompts", () => {
  let n = 0;
  const id = () => `p${++n}`;

  it("keeps text a console can paste whole: no control characters, one kind of line end", () => {
    expect(promptText("  Review this\r\nthen \x1b[201~stop\tnow\x07  ")).toBe("Review this\nthen [201~stop\tnow");
    expect(promptText(42)).toBe("");
  });

  it("names a prompt after its first words when you give it no name", () => {
    expect(promptTitle("  My   review ", "x")).toBe("My review");
    expect(promptTitle("", "\n Review the changes on this branch for bugs\nand more")).toBe("Review the changes on this");
    expect(promptTitle(undefined, "a".repeat(80))).toHaveLength(40);
  });

  it("adds a prompt at the end and changes one in place, never two with the same text", () => {
    const one = withPrompt([], { text: "Plan first" }, id);
    if ("error" in one) throw new Error(one.error);
    expect(one.saved).toEqual({ id: "p1", title: "Plan first", text: "Plan first", model: "", effort: "", mode: "" });
    const two = withPrompt(one.prompts, { title: "PR", text: "Write the PR" }, id);
    if ("error" in two) throw new Error(two.error);
    expect(two.prompts.map((p) => p.title)).toEqual(["Plan first", "PR"]);
    const changed = withPrompt(two.prompts, { id: "p1", title: "Plan", text: "Plan first, then ask" }, id);
    if ("error" in changed) throw new Error(changed.error);
    expect(changed.prompts.map((p) => [p.id, p.title])).toEqual([["p1", "Plan"], ["p2", "PR"]]);
    expect(withPrompt(changed.prompts, { text: " Write the PR " }, id)).toEqual({ error: "That prompt is saved already, as “PR”." });
    expect(withPrompt(changed.prompts, { id: "p1", text: "Write the PR" }, id)).toMatchObject({ error: expect.stringContaining("saved already") });
    expect(withPrompt(changed.prompts, { id: "p1", text: "  " }, id)).toEqual({ error: "A prompt needs some text." });
  });

  it("keeps the model, effort and mode a prompt starts with, and drops ones Claude Code would not take", () => {
    expect(promptTune({ model: "opus", effort: "xhigh", mode: "plan" })).toEqual({ model: "opus", effort: "xhigh", mode: "plan" });
    expect(promptTune({ model: "rm -rf /", effort: "huge", mode: "yolo" })).toEqual({ model: "", effort: "", mode: "" });
    const saved = withPrompt([], { text: "Plan it", model: "opus", effort: "high", mode: "plan" }, id);
    if ("error" in saved) throw new Error(saved.error);
    // A change that leaves them out keeps them; "" clears one.
    const renamed = withPrompt(saved.prompts, { id: saved.saved.id, title: "Plan", text: "Plan it" }, id);
    if ("error" in renamed) throw new Error(renamed.error);
    expect(renamed.saved).toMatchObject({ title: "Plan", model: "opus", effort: "high", mode: "plan" });
    const cleared = withPrompt(renamed.prompts, { id: saved.saved.id, text: "Plan it", mode: "" }, id);
    if ("error" in cleared) throw new Error(cleared.error);
    expect(cleared.saved).toMatchObject({ model: "opus", effort: "high", mode: "" });
  });

  it("finds the slots to fill in a prompt and puts in the values given", () => {
    const text = "review <PR URL> with the agent.\nread <shortcut URL or description>, then <PR URL> again. a < b > c, <div>x</div>";
    expect(promptSlots(text)).toEqual(["PR URL", "shortcut URL or description", "div"]);
    expect(fillSlots(text, { "PR URL": " https://github.com/o/r/pull/1 ", div: "" })).toBe(
      "review https://github.com/o/r/pull/1 with the agent.\nread <shortcut URL or description>, then https://github.com/o/r/pull/1 again. a < b > c, <div>x</div>",
    );
    expect(promptSlots("no slots here")).toEqual([]);
  });

  it("puts a picked prompt in place of the one picked before, keeping what you typed ahead of it", () => {
    const review = { id: "r", text: "review <PR URL>" };
    const plan = { id: "p", text: "plan <ticket>" };
    let st = pickPrompt("", null, review);
    expect(st.message).toBe("review <PR URL>");
    st = pickPrompt(st.message, st.picked, plan); // going over the chips swaps the prompt; its slots go with it
    expect(st.message).toBe("plan <ticket>");
    expect(promptSlots(st.message)).toEqual(["ticket"]);
    st = pickPrompt(st.message, st.picked, plan); // the same chip again takes it out
    expect(st).toEqual({ message: "", picked: null });

    st = pickPrompt("my own words", null, review);
    expect(st.message).toBe("my own words\n\nreview <PR URL>");
    st = pickPrompt(st.message, st.picked, plan);
    expect(st.message).toBe("my own words\n\nplan <ticket>");
    // Changed by hand, the message is all yours: the next chip goes after it.
    st = pickPrompt(st.message + " for sc-1", st.picked, review);
    expect(st.message).toBe("my own words\n\nplan <ticket> for sc-1\n\nreview <PR URL>");
  });

  it("stops at the most it keeps", () => {
    const full = Array.from({ length: MAX_PROMPTS }, (_, i) => ({ id: `f${i}`, title: `${i}`, text: `${i}`, model: "", effort: "", mode: "" }));
    expect(withPrompt(full, { text: "one more" }, id)).toMatchObject({ error: expect.stringContaining(`${MAX_PROMPTS}`) });
    expect(withPrompt(full, { id: "f0", text: "changed" }, id)).not.toHaveProperty("error");
  });

  it("reads the saved ones from the file, dropping broken ones and repeats", () => {
    const s = cleanSettings({ prompts: [{ id: "a", text: "Hi" }, { id: "b", text: " Hi " }, { id: "../x", text: "y" }, { text: "no id" }, "junk", { id: "c", title: "T", text: "Go" }] as never });
    expect(s.prompts).toEqual([
      { id: "a", title: "Hi", text: "Hi", model: "", effort: "", mode: "" },
      { id: "c", title: "T", text: "Go", model: "", effort: "", mode: "" },
    ]);
    expect(cleanPrompts(undefined)).toEqual([]);
    expect(cleanSettings({}).prompts).toEqual([]);
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

  it("drops a branch's PR that was done before the session started", () => {
    const started = Date.parse("2026-11-04T15:12:29Z");
    const pr = (state: PrRow["state"], mergedAt: string | null, updatedAt: string) => ({ number: 1450, state, mergedAt, updatedAt }) as PrRow;
    // The checkout was left on a branch whose PR merged earlier: that work isn't this session's.
    expect(openSince(pr("MERGED", "2026-11-04T14:29:29Z", "2026-11-04T14:29:30Z"), started)).toBeNull();
    expect(openSince(pr("CLOSED", null, "2026-11-03T09:00:00Z"), started)).toBeNull();
    expect(openSince(pr("MERGED", "2026-11-04T16:00:00Z", "2026-11-04T16:00:00Z"), started)?.number).toBe(1450);
    expect(openSince(pr("OPEN", null, "2026-10-01T00:00:00Z"), started)?.number).toBe(1450);
    expect(openSince(null, started)).toBeNull();
  });
});

describe("the cards at the top", () => {
  it("lays out only the cards that show, each its dragged width or its usual share, and the tray last", () => {
    expect(cardColumns(["sessions", "mac"], {}, false)).toBe("minmax(200px, 270fr) minmax(250px, 315fr)");
    expect(cardColumns(["sessions", "usage"], { sessions: 514 }, true)).toBe("minmax(200px, 514fr) minmax(290px, 390fr) max-content");
  });

  it("moves a gap between two cards only as far as each one's least width", () => {
    expect(dragGap({ w: 300, min: 200 }, { w: 400, min: 280 }, 50)).toEqual([350, 350]);
    expect(dragGap({ w: 300, min: 200 }, { w: 400, min: 280 }, 500)).toEqual([420, 280]);
    expect(dragGap({ w: 300, min: 200 }, { w: 400, min: 280 }, -500)).toEqual([200, 500]);
  });

  it("knows when every card is folded", () => {
    expect(allHidden(["sessions", "attention", "prs", "usage", "mac"])).toBe(true);
    expect(allHidden(["sessions", "prs"])).toBe(false);
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

describe("PATH from your login shell", () => {
  it("puts your shell's folders first and keeps the rest once", () => {
    expect(mergePath("/nvm/bin:/usr/bin", "/opt/homebrew/bin:/usr/bin::/bin")).toBe("/nvm/bin:/usr/bin:/opt/homebrew/bin:/bin");
  });

  it("reads PATH past what ~/.zshrc prints, and gives up on a shell that says nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cr-shell-"));
    const shell = join(dir, "fake-shell");
    // Stands in for zsh -lic: prints a greeting the way an rc file may, adds an nvm-style folder, runs the command.
    writeFileSync(shell, '#!/bin/sh\necho "welcome back"\nPATH="/fake/nvm/bin:$PATH" exec /bin/sh -c "$2"\n');
    chmodSync(shell, 0o755);
    expect((await loginShellPath(shell))?.split(":")[0]).toBe("/fake/nvm/bin");
    const mute = join(dir, "mute-shell");
    writeFileSync(mute, "#!/bin/sh\nexit 1\n");
    chmodSync(mute, 0o755);
    expect(await loginShellPath(mute)).toBeNull();
    expect(await loginShellPath(join(dir, "missing"))).toBeNull();
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

  it("puts the tab's name first, then a name saved here, then /rename, the story, and Claude Code's own title", () => {
    const parts: NameParts = { tab: "Dark mode 2", saved: "Dark mode, saved", custom: "Settings | P6", title: "Shortcut story 1 dark mode", story: "1-Settings Dark Mode", headline: "Adding a dark theme", branch: "sc-1-dark-mode", folder: "repo", prompted: true };
    expect(pickName(parts)).toEqual(["Dark mode 2", "tab"]);
    expect(pickName({ ...parts, tab: null })).toEqual(["Dark mode, saved", "saved"]);
    parts.saved = null;
    expect(pickName({ ...parts, tab: null })).toEqual(["Settings | P6", "custom"]);
    // Claude Code's title only retells the request; the story says what the work is.
    expect(pickName({ ...parts, tab: null, custom: null })).toEqual(["1-Settings Dark Mode", "story"]);
    expect(pickName({ ...parts, tab: null, custom: null, story: null })).toEqual(["Shortcut story 1 dark mode", "title"]);
    // A branch or folder name says little, so the plain-English headline goes before it.
    expect(pickName({ ...parts, tab: null, custom: null, title: null, story: null })).toEqual(["Adding a dark theme", "summary"]);
    expect(pickName({ ...parts, tab: null, custom: null, title: null, story: null, headline: null })).toEqual(["sc-1-dark-mode", "branch"]);
    expect(pickName({ tab: null, saved: null, custom: null, title: null, story: null, headline: null, branch: null, folder: "repo", prompted: true })).toEqual(["repo", "folder"]);
  });

  it("calls a session New session until its first prompt, not after the branch it starts on", () => {
    const fresh: NameParts = { tab: null, saved: null, custom: null, title: null, story: "Already in NetSuite", headline: null, branch: "26012_already_in_netsuite", folder: "shield", prompted: false };
    expect(pickName(fresh)).toEqual(["New session", "new"]);
    // A name somebody gave it still counts: claude --name, /rename, a tab, a saved name.
    expect(pickName({ ...fresh, title: "Login fix" })).toEqual(["Login fix", "title"]);
    expect(pickName({ ...fresh, saved: "Mine" })).toEqual(["Mine", "saved"]);
    expect(pickName({ ...fresh, prompted: true })).toEqual(["Already in NetSuite", "story"]);
  });

  it("gives a story's sessions a short title, the story's own name until there is one", () => {
    expect(plainTicketTitle("1d | Truck alerts - BE: opt-in (recipients, subscribe/unsubscribe)")).toBe("Truck alerts - BE: opt-in");
    expect(plainTicketTitle("0.5d | Fix [urgent] login")).toBe("Fix login");
    expect(plainTicketTitle("Upload updates")).toBe("Upload updates");
    expect(plainTicketTitle("(draft)")).toBe("(draft)");
    expect(parseTicketTitle('{"title": "Logistics Truck Alerts."}')).toBe("Logistics Truck Alerts");
    expect(parseTicketTitle('Sure: {"title":"Hold Deep Links"}')).toBe("Hold Deep Links");
    // Talk instead of a title, or one far too long, is no short title.
    for (const reply of ["Epic is a catch-all, so I'm naming the story instead.", '{"title": "A title that goes on and on for many more words"}', '{"title": ""}', "{"]) {
      expect(parseTicketTitle(reply)).toBeNull();
    }
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

  it("opens in an IDE this Mac has, when the one in Settings is missing", () => {
    expect(chosenIde("pycharm", ["cursor", "pycharm"])).toBe("pycharm");
    expect(chosenIde("vscode", [])).toBe("vscode"); // none found: the setting stands, and says so when used
    expect(chosenIde("zed", ["cursor", "pycharm"])).toBe("cursor");
    expect(chosenIde("zed", ["cursor", "pycharm"], ["pycharm"])).toBe("pycharm"); // the one Claude Code is connected to
  });

  it("takes only a real folder for terminals, with ~ for home", () => {
    expect(folderSetting("~")).toBe(homedir());
    expect(folderSetting(` ${tmpdir()}/ `)).toBe(tmpdir());
    for (const v of ["", "relative/path", "/no/such/folder", `${tmpdir()}/../${tmpdir().split("/").pop()}/nope`, 3, null]) expect(folderSetting(v)).toBeNull();
    expect(folderSetting(import.meta.filename)).toBeNull(); // a file, not a folder
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

describe("other Claude accounts", () => {
  const home = homedir();

  it("takes an account's folder by its full path, but none that holds something else", () => {
    expect(accountDir("~/.claude-personal/")).toBe(join(home, ".claude-personal"));
    expect(accountDir("/Volumes/x/claude")).toBe("/Volumes/x/claude");
    for (const bad of ["~/.claude", "~/.claude/", "~/.Claude", "~/.claude/personal", "~", "/", "/Users", "~/.claude-control-room", "~/.claude-control-room/x", "relative/dir", "", 7, null]) {
      expect(accountDir(bad)).toBeNull();
    }
  });

  it("keeps the saved accounts that make sense, each folder once", () => {
    const saved = [
      { label: "  Personal  ", dir: "~/.claude-personal" },
      { label: "Again", dir: "~/.claude-personal/" },
      { label: "", dir: "~/.claude-x" },
      { label: "Side", dir: "~/.claude" },
      "junk",
      { label: "Side", dir: "/opt/claude-side" },
    ];
    expect(cleanAccounts(saved)).toEqual([
      { label: "Personal", dir: join(home, ".claude-personal") },
      { label: "Side", dir: "/opt/claude-side" },
    ]);
    expect(cleanAccounts(Array.from({ length: 9 }, (_, i) => ({ label: `A${i}`, dir: `/opt/a${i}` })))).toHaveLength(5);
    // One folder inside another, or the same in other letters, would mix the two accounts' files.
    expect(cleanAccounts([{ label: "A", dir: "/opt/a" }, { label: "B", dir: "/opt/a/b" }, { label: "C", dir: "/OPT/A" }, { label: "D", dir: "/opt" }])).toEqual([{ label: "A", dir: "/opt/a" }]);
    expect(cleanSettings({}).accounts).toEqual([]);
    // The usual account's name: "Default" until you give it one.
    expect(cleanSettings({}).defaultAccountLabel).toBe("Default");
    expect(cleanSettings({ defaultAccountLabel: "  Work  " }).defaultAccountLabel).toBe("Work");
    expect(cleanSettings({ defaultAccountLabel: "   " }).defaultAccountLabel).toBe("Default");
    // New sessions start on the usual account, unless Settings names another one that is still there.
    expect(cleanSettings({}).newSessionAccount).toBe("");
    const personal = { label: "Personal", dir: "/opt/claude-personal" };
    expect(cleanSettings({ accounts: [personal], newSessionAccount: personal.dir }).newSessionAccount).toBe(personal.dir);
    expect(cleanSettings({ accounts: [], newSessionAccount: personal.dir }).newSessionAccount).toBe("");
  });

  it("knows the account of a file by the folder it lies in", () => {
    const list = homes([{ label: "Personal", dir: "/x/.claude-personal" }]);
    expect(homeOf("/x/.claude-personal/projects/-a/1.jsonl", list)?.account?.label).toBe("Personal");
    expect(homeOf(join(home, ".claude", "projects", "-a", "1.jsonl"), list)?.account).toBeNull();
    expect(homeOf("/x/.claude-personal-2/projects/-a/1.jsonl", list)).toBeNull();
    const nested = homes([{ label: "Outer", dir: "/x/a" }, { label: "Inner", dir: "/x/a/b" }]);
    expect(homeOf("/x/a/b/projects/1.jsonl", nested)?.account?.label).toBe("Inner");
  });

  it("writes the command for another account so it pastes safely", () => {
    expect(claudeCommand(null)).toBe("claude");
    expect(claudeCommand({ dir: "/Users/me/my claude" })).toBe("CLAUDE_CONFIG_DIR='/Users/me/my claude' claude");
  });
});

describe("shortcuts", () => {
  const press = (key: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean; code?: string } = {}) =>
    commandOf({ key, code: mods.code ?? "", metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt } as KeyboardEvent);

  it("knows the ones that work in a console, as PyCharm has them", () => {
    expect(press("n", { meta: true })).toEqual({ id: "newSession" });
    expect(press("t", { meta: true })).toEqual({ id: "newTerminal" });
    expect(press(",", { meta: true })).toEqual({ id: "settings" });
    expect(press("/", { meta: true })).toEqual({ id: "help" });
    expect(press("3", { meta: true })).toEqual({ id: "pick", n: 3 });
    expect(press("ArrowDown", { meta: true })).toEqual({ id: "next" });
    expect(press("ArrowUp", { meta: true })).toEqual({ id: "prev" });
    expect(press("k", { meta: true })).toEqual({ id: "jump" });
    expect(press("e", { meta: true })).toEqual({ id: "jump" });
    expect(press("ArrowDown")).toBeNull(); // a plain arrow is the console's, and Claude Code's
    expect(press("Tab", { ctrl: true })).toEqual({ id: "next" });
    expect(press("Tab", { ctrl: true, shift: true })).toEqual({ id: "prev" });
    expect(press("F6", { shift: true })).toEqual({ id: "rename" });
    expect(press("Escape", { shift: true })).toEqual({ id: "leave" });
    expect(press("F4", { shift: true })).toEqual({ id: "popout" });
    // ⌥ changes the letter a key types, so these go by the key itself.
    expect(press("®", { meta: true, alt: true, code: "KeyR" })).toEqual({ id: "finder" });
    expect(press("C", { meta: true, shift: true, code: "KeyC" })).toEqual({ id: "copyResume" });
    expect(press("Ç", { meta: true, alt: true, shift: true, code: "KeyC" })).toEqual({ id: "copyId" });
    expect(press("ç", { alt: true, code: "KeyC" })).toBeNull();
  });

  it("knows the single keys for a session, and the answer numbers only in its menu", () => {
    const key = (k: string, mods: { shift?: boolean; meta?: boolean } = {}, inMenu = false) =>
      sessionKeyOf({ key: k, metaKey: !!mods.meta, ctrlKey: false, altKey: false, shiftKey: !!mods.shift } as KeyboardEvent, inMenu);
    expect(key("Enter")).toEqual({ id: "open" });
    expect(key(" ")).toEqual({ id: "details" });
    expect(key("o")).toEqual({ id: "ide" });
    expect(key("c")).toEqual({ id: "remote" });
    expect(key("x")).toEqual({ id: "close" });
    expect(key("F2")).toEqual({ id: "rename" });
    expect(key("Home", { shift: true })).toEqual({ id: "moveFront" });
    expect(key("End", { shift: true })).toEqual({ id: "moveEnd" });
    expect(key("Home")).toBeNull(); // that one picks the first session
    expect(key("3", {}, true)).toEqual({ id: "answer", n: 3 });
    expect(key("3")).toBeNull();
    expect(key("o", { meta: true })).toBeNull();
  });

  it("leaves the shell and Claude Code their keys", () => {
    for (const key of ["n", "t", "c", "r", "a"]) expect(press(key, { ctrl: true })).toBeNull(); // ⌃N, ⌃T, ⌃C… mean something there
    expect(press("c", { meta: true })).toBeNull(); // copy and paste stay the Mac's
    expect(press("v", { meta: true })).toBeNull();
    expect(press("Escape")).toBeNull();
    expect(press("n")).toBeNull(); // a plain letter is typing
    expect(press("Enter", { shift: true })).toBeNull();
  });

  it("lists every shortcut in the guide once", () => {
    const listed = KEY_GROUPS.flatMap((g) => g.ids);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(KEYS).sort());
  });
});

describe("signing in", () => {
  it("takes the sign-in link out of what claude prints, without the escape codes around it", () => {
    const link = "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=x_y-z";
    const printed = `Opening browser to sign in…\nIf the browser didn't open, visit: \x1b]8;;${link}\x1b\\${link}\x1b]8;;\x1b\\\nPaste code here if prompted >`;
    expect(signInUrl(printed)).toBe(link);
    expect(signInUrl("visit https://example.com/oauth?x=1")).toBeNull();
    // What the CLI hands its browser comes back here whole: the link whose sign-in returns to it by itself.
    const file = join(mkdtempSync(join(tmpdir(), "cr-signin-")), "link.url");
    const back = "https://claude.com/cai/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A54321%2Fcallback&state=a b";
    execFileSync("/bin/sh", ["-c", BROWSER_BODY, "sh", back], { env: { CONTROL_ROOM_SIGNIN: file } });
    expect(readFileSync(file, "utf8")).toBe(`${back}\n`);
    expect(signInUrl("nothing here")).toBeNull();
  });
});
