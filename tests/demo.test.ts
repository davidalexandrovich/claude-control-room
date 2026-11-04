// The demo feeds the README screenshots and `npm run demo`: it must stay true to the live rules and touch nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Snapshot } from "../shared/types.ts";
import { demoClosePlan, DEMO_MAX_COUNT, demoSnapshot, demoWorktrees } from "../server/demo-data.ts";
import { startDemo, type DemoRunning } from "../server/demo.ts";

const NOW = 1_800_000_000_000;

describe("demo data", () => {
  it("shows every status a tile can show, newest session first", () => {
    const snap = demoSnapshot(NOW, DEMO_MAX_COUNT);
    const kinds = new Set(snap.sessions.map((s) => s.activity.kind));
    for (const kind of ["working", "approval", "question", "background", "idle", "inactive"]) expect(kinds).toContain(kind);
    expect(snap.sessions.some((s) => s.activity.askedYou)).toBe(true);
    expect(snap.sessions.map((s) => s.startedAt)).toEqual([...snap.sessions.map((s) => s.startedAt)].sort((a, b) => b - a));
    expect(new Set(snap.sessions.map((s) => s.pid)).size).toBe(snap.sessions.length);
  });

  it("uses made-up places only", () => {
    const snap = demoSnapshot(NOW, DEMO_MAX_COUNT);
    for (const s of snap.sessions) expect(s.cwd.startsWith("/Users/you/code/")).toBe(true);
    expect(snap.account.email).toBe("you@example.com");
  });

  it("gives the advice the live app would give", () => {
    const snap = demoSnapshot(NOW);
    const merged = snap.sessions.find((s) => s.pr?.state === "MERGED")!;
    expect(demoClosePlan(merged, snap.sessions, NOW).worktree?.verdict).toBe("safe");
    const repo = snap.sessions[0].git!.mainRoot;
    const verdicts = demoWorktrees(repo, snap.sessions, NOW).map((r) => r.verdict);
    for (const v of ["main", "in-use", "safe", "probably-safe", "keep", "gone"]) expect(verdicts).toContain(v);
  });
});

describe("demo server", () => {
  let demo: DemoRunning;
  const post = (path: string, body: unknown = {}, headers: Record<string, string> = { "X-Control-Room": "1" }) =>
    fetch(`${demo.url}${path.slice(1)}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const snapshot = async () => (await (await fetch(`${demo.url}api/snapshot`)).json()) as Snapshot;

  beforeAll(async () => {
    // Every sample session, so one is still asking after the first test has answered some.
    demo = await startDemo({ port: 0, sessions: DEMO_MAX_COUNT });
  });
  afterAll(() => demo.stop());

  it("moves a session along when you approve or answer", async () => {
    const before = await snapshot();
    const asking = before.sessions.find((s) => s.activity.kind === "approval")!;
    expect((await (await post(`/api/sessions/${asking.pid}/approve`)).json()).ok).toBe(true);
    const after = await snapshot();
    expect(after.sessions.find((s) => s.pid === asking.pid)?.activity.kind).toBe("working");

    const question = after.sessions.find((s) => s.activity.kind === "question")!;
    const answer = await (await post(`/api/sessions/${question.pid}/answer`, { option: 0 })).json();
    expect(answer.message).toContain(question.activity.question!.options[0].label);
  });

  it("sends a session to the phone, but not while it asks you something", async () => {
    const before = await snapshot();
    const idle = before.sessions.find((s) => s.activity.kind === "idle" && !s.remoteUrl)!;
    expect((await (await post(`/api/sessions/${idle.pid}/remote`)).json()).ok).toBe(true);
    expect((await snapshot()).sessions.find((s) => s.pid === idle.pid)?.remoteUrl).toMatch(/^https:\/\/claude\.ai\/code\//);
    expect((await (await post(`/api/sessions/${idle.pid}/remote`)).json()).message).toMatch(/already/);

    const asking = before.sessions.find((s) => s.activity.kind === "approval" || s.activity.kind === "question")!;
    const refused = await (await post(`/api/sessions/${asking.pid}/remote`)).json();
    expect(refused.ok).toBe(false);
    expect((await snapshot()).sessions.find((s) => s.pid === asking.pid)?.remoteUrl).toBeNull();
  });

  it("renames a session, and refuses an empty name", async () => {
    const s = (await snapshot()).sessions[0];
    expect((await (await post(`/api/sessions/${s.pid}/rename`, { name: "  Checkout\ntests " })).json()).ok).toBe(true);
    const renamed = (await snapshot()).sessions.find((x) => x.pid === s.pid)!;
    expect([renamed.name, renamed.nameSource]).toEqual(["Checkout tests", "tab"]);
    expect((await (await post(`/api/sessions/${s.pid}/rename`, { name: " " })).json()).ok).toBe(false);
  });

  it("saves a known IDE for Open in, and ignores an unknown one", async () => {
    expect((await post("/api/settings", { ide: "zed" })).status).toBe(200);
    expect((await snapshot()).settings.ide).toBe("zed");
    await post("/api/settings", { ide: "notepad" });
    expect((await snapshot()).settings.ide).toBe("zed");
    await post("/api/settings", { ide: "vscode" });
  });

  it("keeps the live server's guards", async () => {
    expect((await post("/api/power", { on: false }, {})).status).toBe(403);
    expect((await fetch(`${demo.url}api/snapshot`, { headers: { Origin: "https://example.com" } })).status).toBe(403);
  });
});
