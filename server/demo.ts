// The demo: the real UI with sample sessions (server/demo-data.ts). It reads nothing from this Mac and changes
// nothing; actions only move the sample sessions along. Run: npm run demo
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { ideName, isIdeId } from "../shared/ides.ts";
import type { ActionResult, Session, Settings, Snapshot, WorktreeReport } from "../shared/types.ts";
import { demoClosePlan, DEMO_DEFAULT_COUNT, demoSnapshot, demoWorktrees } from "./demo-data.ts";
import { body, refusal, send, serveStatic } from "./http.ts";
import { cleanName } from "./names.ts";
import { sudoersLine } from "./power.ts";
import { remoteRefusal } from "./remote.ts";

export interface DemoRunning {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

const NOT_HERE = "This is the demo. In the app, this button works for real.";

export async function startDemo(opts: { port?: number; sessions?: number } = {}): Promise<DemoRunning> {
  let snap: Snapshot = demoSnapshot(Date.now(), opts.sessions ?? DEMO_DEFAULT_COUNT);
  const scans = new Map<string, { reports: WorktreeReport[]; finishedAt: number }>();
  const listeners = new Set<(s: Snapshot) => void>();

  const publish = () => {
    snap = { ...snap, at: Date.now() };
    listeners.forEach((l) => l(snap));
  };
  const find = (pid: number) => snap.sessions.find((s) => s.pid === pid) ?? null;
  const update = (pid: number, change: (s: Session) => Partial<Session>) => {
    snap = { ...snap, sessions: snap.sessions.map((s) => (s.pid === pid ? { ...s, ...change(s) } : s)) };
    publish();
  };
  const working = (detail: string) => (s: Session) => ({
    activity: { ...s.activity, kind: "working" as const, label: "Working", detail, tool: null, question: null, since: Date.now() },
  });
  const scanOf = (repo: string) => {
    let scan = scans.get(repo);
    if (!scan) scans.set(repo, (scan = { reports: demoWorktrees(repo, snap.sessions, Date.now()), finishedAt: Date.now() }));
    return scan;
  };
  const known = (repo: unknown) => typeof repo === "string" && snap.sessions.some((s) => s.git?.mainRoot === repo);

  async function sessionAction(pid: number, action: string, req: IncomingMessage): Promise<ActionResult | null> {
    const s = find(pid);
    if (!s) return { ok: false, message: "That session has ended" };
    switch (action) {
      case "approve":
        if (s.activity.kind !== "approval") return { ok: false, message: "Nothing to approve" };
        update(pid, working(s.activity.tool?.tool === "ExitPlanMode" ? "Starting step 1 of the plan" : (s.activity.detail ?? "Thinking…")));
        return { ok: true, message: "Approved" };
      case "reject":
        if (s.activity.kind !== "approval") return { ok: false, message: "Nothing to reject" };
        update(pid, (x) => ({ activity: { ...x.activity, kind: "idle", label: "Idle", detail: "You said no, so it stopped", tool: null, since: Date.now() } }));
        return { ok: true, message: "Rejected" };
      case "answer": {
        const option = s.activity.question?.options[(await body<{ option: number }>(req)).option];
        if (!option) return { ok: false, message: "Unknown answer" };
        update(pid, working("Thinking…"));
        return { ok: true, message: `Answered “${option.label}”` };
      }
      case "focus":
        return { ok: true, message: `In the app, this opens the session in ${ideName(snap.settings.ide)}.` };
      case "close":
        snap = { ...snap, sessions: snap.sessions.filter((x) => x.pid !== pid) };
        publish();
        return { ok: true, message: `Closed “${s.name}”` };
      case "remote": {
        if (s.remoteUrl) return { ok: true, message: "It is already on your phone." };
        const asking = s.activity.kind === "approval" || s.activity.kind === "question";
        const refused = remoteRefusal({ status: asking ? "waiting" : null });
        if (refused) return { ok: false, message: refused };
        update(pid, () => ({ remoteUrl: `https://claude.ai/code/session_demo${pid}` }));
        return { ok: true, message: "On your phone now: open the Claude app and tap Code." };
      }
      case "rename": {
        const name = cleanName((await body<{ name?: unknown }>(req)).name);
        if (!name) return { ok: false, message: "Type a name first." };
        update(pid, () => ({ name, nameSource: "tab" as const }));
        return { ok: true, message: `Renamed to “${name}”` };
      }
    }
    return null;
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const p = url.pathname;
    if (req.method === "GET" && p === "/api/snapshot") return send(res, 200, snap);
    if (req.method === "GET" && p === "/api/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      const push = (s: Snapshot) => res.write(`event: snapshot\ndata: ${JSON.stringify(s)}\n\n`);
      push(snap);
      listeners.add(push);
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        listeners.delete(push);
        clearInterval(ping);
      });
      return;
    }
    let m = /^\/api\/sessions\/(\d+)\/(chat|close-plan)$/.exec(p);
    if (req.method === "GET" && m) {
      const s = find(Number(m[1]));
      if (m[2] === "chat") return send(res, 200, { chat: s?.chat ?? [] });
      return send(res, 200, s ? demoClosePlan(s, snap.sessions, Date.now()) : null);
    }
    if (req.method === "GET" && p === "/api/worktrees") {
      const repo = url.searchParams.get("repo");
      if (!known(repo)) return send(res, 404, { ok: false, message: "Unknown repo" });
      const scan = scanOf(repo!);
      return send(res, 200, { repo, running: false, done: scan.reports.length, total: scan.reports.length, reports: scan.reports, startedAt: scan.finishedAt, finishedAt: scan.finishedAt });
    }
    if (req.method !== "POST") return send(res, 404, { ok: false, message: "Not found" });

    m = /^\/api\/sessions\/(\d+)\/(approve|reject|answer|focus|close|remote|rename)$/.exec(p);
    if (m) {
      const out = await sessionAction(Number(m[1]), m[2], req);
      return send(res, out ? 200 : 404, out ?? { ok: false, message: "Unknown action" });
    }
    switch (p) {
      case "/api/settings": {
        const b = await body<Partial<Settings>>(req);
        const patch: Partial<Settings> = {};
        for (const key of ["notifications", "sounds", "aiSummaries", "includeIdePanel"] as const) {
          if (typeof b[key] === "boolean") patch[key] = b[key];
        }
        if (typeof b.inactiveAfterMinutes === "number" && b.inactiveAfterMinutes >= 5) patch.inactiveAfterMinutes = b.inactiveAfterMinutes;
        if (b.layout === "fit" || b.layout === "comfortable" || b.layout === "focus") patch.layout = b.layout;
        if (isIdeId(b.ide)) patch.ide = b.ide;
        snap = { ...snap, settings: { ...snap.settings, ...patch } };
        publish();
        return send(res, 200, { ok: true, message: "Saved" });
      }
      case "/api/power": {
        const on = (await body<{ on: boolean }>(req)).on === true;
        snap = { ...snap, power: { ...snap.power, sleepDisabled: on } };
        publish();
        return send(res, 200, { ok: true, message: on ? "This Mac stays awake" : "This Mac sleeps normally again" });
      }
      case "/api/power/sudoers":
        return send(res, 200, { ok: true, message: sudoersLine("you") });
      case "/api/worktrees/scan": {
        const repo = (await body<{ repo: string }>(req)).repo;
        if (!known(repo)) return send(res, 404, { ok: false, message: "Unknown repo" });
        scanOf(repo).finishedAt = Date.now();
        return send(res, 200, { ok: true, message: "Scanning" });
      }
      case "/api/worktrees/remove":
      case "/api/worktrees/prune": {
        const b = await body<{ repo: string; paths?: string[] }>(req);
        if (!known(b.repo)) return send(res, 404, { ok: false, message: "Unknown repo" });
        const scan = scanOf(b.repo);
        const gone = (r: WorktreeReport) => (p.endsWith("prune") ? r.verdict === "gone" : (b.paths ?? []).includes(r.path));
        const n = scan.reports.filter(gone).length;
        scan.reports = scan.reports.filter((r) => !gone(r));
        return send(res, 200, { ok: true, message: `${p.endsWith("prune") ? "Pruned" : "Deleted"} ${n} (only in the demo)` });
      }
    }
    return send(res, 200, { ok: true, message: NOT_HERE });
  }

  let port = 0;
  const server = createServer((req, res) => {
    const refused = refusal(req, port);
    if (refused) return send(res, 403, { ok: false, message: refused });
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const work = url.pathname.startsWith("/api/") ? handleApi(req, res, url) : serveStatic(res, url.pathname);
    work.catch((err: Error) => {
      if (!res.headersSent) send(res, 500, { ok: false, message: err.message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? Number(process.env.CONTROL_ROOM_DEMO_PORT ?? 4318), "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const running = await startDemo({ sessions: Number(process.env.CONTROL_ROOM_DEMO_SESSIONS) || undefined });
  console.log(`The Control Room demo runs at ${running.url} (sample sessions only; Ctrl+C stops it)`);
}
