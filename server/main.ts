import { existsSync } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ActionResult, CloseRequest, Settings } from "../shared/types.ts";
import { currentAccount, readAccount, startAccountSwitch } from "./account.ts";
import {
  answerPermission,
  answerQuestion,
  closePlan,
  closeSession,
  focusSession,
  openFolder,
  openUrl,
  pruneWorktrees,
  removeWorktrees,
  startRemoteControl,
} from "./actions.ts";
import { repoClaims } from "./claims.ts";
import { loadSettings, saveSettings, settings } from "./config.ts";
import { listWorktrees } from "./git.ts";
import { allPrs, checkGh } from "./github.ts";
import { body, DEV_ORIGINS, DIST, refusal, send, serveStatic } from "./http.ts";
import { Monitor } from "./monitor.ts";
import { APP_DIR, BRIDGE_FILE, TAP_DIR } from "./paths.ts";
import { readPower, setSleepDisabled, sudoersLine } from "./power.ts";
import { forgetStories, testToken } from "./shortcut.ts";
import { installStatusLine, uninstallStatusLine } from "./statusline.ts";
import { installHelper, openStream, resolveResult, updateWindow } from "./vscode.ts";
import { buildReport, insidePath, prsByBranch, scanRepo, type ScanJob } from "./worktrees.ts";

export { loginAgeSeconds } from "./proc.ts";

const VSIX = join(DIST, "control-room-bridge.vsix");

export interface Running {
  port: number;
  url: string;
  monitor: Monitor;
  stop: () => Promise<void>;
}

async function cleanOldTaps(): Promise<void> {
  try {
    const week = Date.now() - 7 * 24 * 3_600_000;
    for (const n of await readdir(TAP_DIR)) {
      const p = join(TAP_DIR, n);
      if ((await stat(p)).mtimeMs < week) await unlink(p).catch(() => {});
    }
  } catch {
    /* no taps yet */
  }
}

export async function startServer(opts: { port?: number; dev?: boolean } = {}): Promise<Running> {
  await mkdir(APP_DIR, { recursive: true });
  await loadSettings();
  const monitor = new Monitor();
  const jobs = new Map<string, ScanJob>();
  const prCache = new Map<string, Awaited<ReturnType<typeof allPrs>>>();
  let port = opts.port ?? Number(process.env.CONTROL_ROOM_PORT ?? 4317);

  const sessionAction = async (pid: number, action: string, req: IncomingMessage): Promise<ActionResult | object | null> => {
    switch (action) {
      case "approve":
        return answerPermission(monitor, pid, true);
      case "reject":
        return answerPermission(monitor, pid, false);
      case "answer":
        return answerQuestion(monitor, pid, (await body<{ option: number }>(req)).option);
      case "focus":
        return focusSession(monitor, pid);
      case "close":
        return closeSession(monitor, pid, await body<CloseRequest>(req));
      case "remote":
        return startRemoteControl(monitor, pid);
    }
    return null;
  };

  const repoOf = (repo: string | undefined) => {
    const known = new Set((monitor.snapshot?.sessions ?? []).map((s) => s.git?.mainRoot).filter(Boolean) as string[]);
    return repo && known.has(repo) ? repo : null;
  };

  const livePidsIn = (path: string) => (monitor.snapshot?.sessions ?? []).filter((s) => insidePath(s.cwd, path)).map((s) => s.pid);

  const claimLookup = async (repo: string) => {
    const reg = await repoClaims(repo, monitor.isLiveClaude);
    return (path: string) => {
      const c = reg?.claims.find((x) => x.worktree === path);
      return c ? { live: c.live, note: c.note } : null;
    };
  };

  const slugOf = (repo: string) => {
    const s = monitor.snapshot?.sessions.find((x) => x.git?.mainRoot === repo && x.git.remote);
    return s?.git?.remote ? `${s.git.remote.owner}/${s.git.remote.name}` : null;
  };

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const p = url.pathname;
    if (req.method === "GET" && p === "/api/snapshot") return send(res, 200, monitor.snapshot);
    if (req.method === "GET" && p === "/api/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      const push = (s: unknown) => res.write(`event: snapshot\ndata: ${JSON.stringify(s)}\n\n`);
      if (monitor.snapshot) push(monitor.snapshot);
      const off = monitor.subscribe(push);
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        off();
        clearInterval(ping);
      });
      return;
    }
    let m = /^\/api\/sessions\/(\d+)\/(chat|close-plan)$/.exec(p);
    if (req.method === "GET" && m) {
      const pid = Number(m[1]);
      if (m[2] === "chat") return send(res, 200, { chat: monitor.transcriptOf(pid)?.chat ?? [] });
      return send(res, 200, await closePlan(monitor, pid));
    }
    if (req.method === "GET" && p === "/api/worktrees") {
      const repo = repoOf(url.searchParams.get("repo") ?? undefined);
      if (!repo) return send(res, 404, { ok: false, message: "Unknown repo" });
      return send(res, 200, jobs.get(repo) ?? null);
    }
    if (req.method !== "POST") return send(res, 404, { ok: false, message: "Not found" });

    m = /^\/api\/sessions\/(\d+)\/(approve|reject|answer|focus|close|remote)$/.exec(p);
    if (m) {
      const out = await sessionAction(Number(m[1]), m[2], req);
      return send(res, out ? 200 : 404, out ?? { ok: false, message: "Unknown action" });
    }
    switch (p) {
      case "/api/open": {
        const b = await body<{ url?: string; folder?: string }>(req);
        if (b.url) return send(res, 200, openUrl(b.url));
        const known = (monitor.snapshot?.sessions ?? []).some((s) => b.folder && insidePath(b.folder, s.git?.mainRoot ?? s.cwd));
        if (b.folder && (known || existsSync(b.folder))) return send(res, 200, openFolder(b.folder));
        return send(res, 400, { ok: false, message: "Nothing to open" });
      }
      case "/api/settings": {
        const b = await body<Partial<Settings> & { addShortcutToken?: string; removeShortcutToken?: number }>(req);
        const patch: Partial<Settings> = {};
        for (const key of ["notifications", "sounds", "aiSummaries", "includeIdePanel"] as const) {
          if (typeof b[key] === "boolean") patch[key] = b[key];
        }
        if (typeof b.inactiveAfterMinutes === "number" && b.inactiveAfterMinutes >= 5) patch.inactiveAfterMinutes = b.inactiveAfterMinutes;
        if (b.layout === "fit" || b.layout === "comfortable" || b.layout === "focus") patch.layout = b.layout;
        let message = "Saved";
        if (b.addShortcutToken) {
          const token = b.addShortcutToken.trim();
          const check = await testToken(token);
          if (!check.ok) return send(res, 200, check);
          patch.shortcutTokens = [...settings().shortcutTokens.filter((t) => t !== token), token];
          message = check.message;
          forgetStories();
        }
        if (typeof b.removeShortcutToken === "number") {
          patch.shortcutTokens = settings().shortcutTokens.filter((_, i) => i !== b.removeShortcutToken);
          forgetStories();
        }
        await saveSettings(patch);
        await monitor.tick();
        return send(res, 200, { ok: true, message });
      }
      case "/api/power": {
        const b = await body<{ on: boolean }>(req);
        const out = await setSleepDisabled(b.on === true);
        await monitor.tick();
        return send(res, 200, out);
      }
      case "/api/power/sudoers":
        return send(res, 200, { ok: true, message: sudoersLine(process.env.USER ?? "") });
      case "/api/setup/statusline": {
        const b = await body<{ install: boolean }>(req);
        const out = b.install ? await installStatusLine() : await uninstallStatusLine();
        await monitor.tick();
        return send(res, 200, out);
      }
      case "/api/setup/vscode":
        return send(res, 200, await installHelper(VSIX));
      case "/api/account/switch":
        return send(res, 200, await startAccountSwitch());
      case "/api/account/refresh":
        await readAccount();
        await monitor.tick();
        return send(res, 200, { ok: true, message: currentAccount().email ?? "Not signed in" });
      case "/api/worktrees/scan": {
        const repo = repoOf((await body<{ repo: string }>(req)).repo);
        if (!repo) return send(res, 404, { ok: false, message: "Unknown repo" });
        const cur = jobs.get(repo);
        if (cur?.running) return send(res, 200, { ok: true, message: "Already scanning" });
        const job: ScanJob = { repo, running: true, done: 0, total: 0, reports: [], startedAt: Date.now(), finishedAt: null };
        jobs.set(repo, job);
        void (async () => {
          const slug = slugOf(repo);
          const prs = slug ? await allPrs(slug) : [];
          prCache.set(repo, prs);
          await scanRepo(job, prs, livePidsIn, await claimLookup(repo));
        })().catch(() => {
          job.running = false;
          job.finishedAt = Date.now();
        });
        return send(res, 200, { ok: true, message: "Scanning" });
      }
      case "/api/worktrees/remove": {
        const b = await body<{ repo: string; paths: string[] }>(req);
        const repo = repoOf(b.repo);
        if (!repo || !Array.isArray(b.paths)) return send(res, 404, { ok: false, message: "Unknown repo" });
        const byBranch = prsByBranch(prCache.get(repo) ?? []);
        const claim = await claimLookup(repo);
        const entries = await listWorktrees(repo);
        const fresh = async (path: string) => {
          const entry = entries.find((e) => e.path === path);
          return entry ? buildReport(repo, entry, { prs: byBranch, livePids: livePidsIn, claim }) : null;
        };
        const job = jobs.get(repo);
        const out = await removeWorktrees(repo, b.paths, monitor.isLiveClaude, fresh, (path) => {
          if (job) job.reports = job.reports.filter((r) => r.path !== path);
        });
        return send(res, 200, out);
      }
      case "/api/worktrees/prune": {
        const repo = repoOf((await body<{ repo: string }>(req)).repo);
        if (!repo) return send(res, 404, { ok: false, message: "Unknown repo" });
        const out = await pruneWorktrees(repo);
        const job = jobs.get(repo);
        if (job && out.ok) job.reports = job.reports.filter((r) => r.verdict !== "gone");
        return send(res, 200, out);
      }
    }
    return send(res, 404, { ok: false, message: "Not found" });
  }

  async function handleBridge(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (req.method === "GET" && url.pathname === "/bridge/stream") {
      const id = url.searchParams.get("window");
      if (!id) return send(res, 400, { ok: false });
      return openStream(id, res);
    }
    if (req.method === "POST" && url.pathname === "/bridge/hello") {
      updateWindow(await body(req));
      void monitor.tick();
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/bridge/result") {
      resolveResult(await body(req));
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { ok: false });
  }

  const server = createServer((req, res) => {
    const refused = refusal(req, port, opts.dev ? DEV_ORIGINS : []);
    if (refused) return send(res, 403, { ok: false, message: refused });
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const route = url.pathname.startsWith("/api/") ? handleApi : url.pathname.startsWith("/bridge/") ? handleBridge : null;
    const work = route ? route(req, res, url) : serveStatic(res, url.pathname);
    work.catch((err: Error) => {
      if (!res.headersSent) send(res, 500, { ok: false, message: err.message });
    });
  });

  for (let attempt = 0; attempt < 12; attempt++) {
    const ok = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (ok) break;
    port++;
  }
  await writeFile(BRIDGE_FILE, JSON.stringify({ port, pid: process.pid, startedAt: Date.now() }) + "\n");

  await cleanOldTaps();
  await Promise.all([readPower(), checkGh(), readAccount()]);
  await monitor.tick();
  const timers = [
    setInterval(() => void monitor.tick(), 1_200),
    setInterval(() => void readPower(), 30_000),
    setInterval(() => void readAccount(), 180_000),
  ];

  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    monitor,
    stop: async () => {
      timers.forEach(clearInterval);
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const running = await startServer({ dev: process.env.CONTROL_ROOM_DEV === "1" });
  console.log(`Control Room is running at ${running.url}`);
}
