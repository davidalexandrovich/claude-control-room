import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isIdeId } from "../shared/ides.ts";
import type { ActionResult, CloseRequest, Settings } from "../shared/types.ts";
import { MAX_ACCOUNTS } from "../shared/claude.ts";
import { withPrompt } from "../shared/prompts.ts";
import { currentAccount, readAccount, readAccounts, refreshLinkScripts, startAccountSwitch } from "./account.ts";
import { accountByDir } from "./homes.ts";
import {
  answerPermission,
  answerQuestion,
  closePlan,
  closeSession,
  focusSession,
  moveSession,
  newSession,
  openFolder,
  openFolderInIde,
  openUrl,
  pruneWorktrees,
  removeWorktrees,
  placeSession,
  renameSession,
  setEffort,
  setMode,
  setModel,
  startRemoteControl,
  startTerminal,
} from "./actions.ts";
import { repoClaims } from "./claims.ts";
import { checkForUpdate, onUpdateBuilt, startUpdate } from "./update.ts";
import { accountDir, accountLabel, folderSetting, loadSettings, overlaps, saveSettings, settings } from "./config.ts";
import { listWorktrees } from "./git.ts";
import { allPrs, checkGh } from "./github.ts";
import { isTyping, resizeConsole, stopConsole, typeInConsole, watchConsole } from "./console.ts";
import { body, DEV_ORIGINS, DIST, refusal, send, serveStatic } from "./http.ts";
import { hostedName } from "./hosted.ts";
import { Monitor } from "./monitor.ts";
import { noteUsed } from "./order.ts";
import { APP_DIR, BRIDGE_FILE, TAP_DIR } from "./paths.ts";
import { readPower, setSleepDisabled, sudoersLine } from "./power.ts";
import { useLoginShellPath } from "./proc.ts";
import { forgetStories, testToken } from "./shortcut.ts";
import { connectLikeUsual, disconnectHome, installStatusLine, uninstallStatusLine } from "./statusline.ts";
import { installHelper, openStream, resolveResult, updateWindow } from "./vscode.ts";
import { buildReport, insidePath, prsByBranch, scanRepo, worksIn, type ScanJob } from "./worktrees.ts";

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

// Actions that count as using a session, so it moves to the front of the list. Closing and renaming do not.
const USED_BY = new Set(["approve", "reject", "answer", "focus", "remote", "move", "model", "effort", "mode"]);
// What a terminal can do; the rest would type Claude Code's keys and commands into a shell.
const FOR_TERMINALS = new Set(["focus", "ide", "close", "rename", "place"]);

export async function startServer(opts: { port?: number; dev?: boolean; installUpdate?: (builtApp: string) => void } = {}): Promise<Running> {
  await mkdir(APP_DIR, { recursive: true });
  await loadSettings();
  if (opts.installUpdate) onUpdateBuilt(opts.installUpdate);
  // A look for new commits soon after the start, then twice an hour.
  setTimeout(() => void checkForUpdate(), 20_000).unref();
  setInterval(() => void checkForUpdate(), 30 * 60_000).unref();
  const monitor = new Monitor();
  const jobs = new Map<string, ScanJob>();
  const prCache = new Map<string, Awaited<ReturnType<typeof allPrs>>>();
  let port = opts.port ?? Number(process.env.CONTROL_ROOM_PORT ?? 4317);

  const sessionAction = async (pid: number, action: string, req: IncomingMessage): Promise<ActionResult | object | null> => {
    const terminal = monitor.snapshot?.sessions.find((s) => s.pid === pid)?.terminal;
    if (terminal && !FOR_TERMINALS.has(action)) return { ok: false, message: "That is a terminal, not Claude Code." };
    switch (action) {
      case "approve":
        return answerPermission(monitor, pid, true);
      case "reject":
        return answerPermission(monitor, pid, false);
      case "answer":
        return answerQuestion(monitor, pid, (await body<{ option: number }>(req)).option);
      case "focus":
        return focusSession(monitor, pid);
      case "ide":
        return openFolderInIde(monitor, pid);
      case "close":
        return closeSession(monitor, pid, await body<CloseRequest>(req));
      case "remote":
        return startRemoteControl(monitor, pid);
      case "rename":
        return renameSession(monitor, pid, (await body<{ name?: unknown }>(req)).name);
      case "move":
        return moveSession(monitor, pid);
      case "model":
        return setModel(monitor, pid, (await body<{ model?: unknown }>(req)).model);
      case "effort":
        return setEffort(monitor, pid, (await body<{ effort?: unknown }>(req)).effort);
      case "mode":
        return setMode(monitor, pid, (await body<{ mode?: unknown }>(req)).mode);
      case "place":
        return placeSession(monitor, pid, await body<{ above?: unknown; below?: unknown }>(req));
    }
    return null;
  };

  const repoOf = (repo: string | undefined) => {
    const known = new Set((monitor.snapshot?.sessions ?? []).map((s) => s.git?.mainRoot).filter(Boolean) as string[]);
    return repo && known.has(repo) ? repo : null;
  };

  const livePidsIn = (path: string) => (monitor.snapshot?.sessions ?? []).filter((s) => worksIn(s, path)).map((s) => s.pid);

  const claimLookup = async (repo: string) => {
    const reg = await repoClaims(repo, monitor.isLiveClaude);
    return (path: string) => {
      const c = reg?.claims.find((x) => x.worktree === path);
      return c ? { live: c.live, note: c.note } : null;
    };
  };

  // Whose link it is: a session's (not a plain terminal's), or an account's by its folder, "" for the usual one.
  const linkEmail = (b: { pid?: unknown; account?: unknown }): string | null => {
    if (typeof b.pid === "number") {
      const s = monitor.snapshot?.sessions.find((x) => x.pid === b.pid);
      return s && !s.terminal ? currentAccount(s.account?.dir ?? null).email : null;
    }
    if (b.account === "") return currentAccount(null).email;
    const ref = accountByDir(b.account);
    return ref ? currentAccount(ref.dir).email : null;
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
    m = /^\/api\/console\/(crt?-[0-9a-f]{8})\/stream$/.exec(p);
    if (req.method === "GET" && m) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      const event = (name: string, data: string) => res.write(`event: ${name}\ndata: ${data}\n\n`);
      const cols = Number(url.searchParams.get("cols") ?? 100);
      const rows = Number(url.searchParams.get("rows") ?? 30);
      const off = watchConsole(m[1], cols, rows, (e) => {
        if (res.writableEnded) return;
        // A window that stopped reading (asleep, or far behind) is dropped; it connects again and starts from a fresh screen.
        if (res.writableLength > 8 * 1024 * 1024) return void res.end();
        if (e.type === "data") return event("data", e.data.toString("base64"));
        if (e.type === "size") return event("size", JSON.stringify({ cols: e.cols, rows: e.rows }));
        if (e.type === "reset") {
          return event("reset", JSON.stringify({ data: e.data.toString("base64"), x: e.x, y: e.y, cursor: e.cursor, cols: e.cols, rows: e.rows }));
        }
        if (e.type === "exit") event("exit", "{}");
        res.end(); // "lost" ends the stream without "exit", so the page connects again
      });
      if (!off) {
        event("exit", "{}");
        return void res.end();
      }
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        off();
        clearInterval(ping);
      });
      return;
    }
    if (req.method === "GET" && p === "/api/worktrees") {
      const repo = repoOf(url.searchParams.get("repo") ?? undefined);
      if (!repo) return send(res, 404, { ok: false, message: "Unknown repo" });
      return send(res, 200, jobs.get(repo) ?? null);
    }
    if (req.method !== "POST") return send(res, 404, { ok: false, message: "Not found" });

    m = /^\/api\/console\/(crt?-[0-9a-f]{8})\/(input|resize|stop)$/.exec(p);
    if (m && m[2] === "stop") {
      const ok = await stopConsole(m[1]);
      await monitor.fresh();
      return send(res, 200, { ok, message: ok ? "Stopped" : "It had stopped already." });
    }
    if (m) {
      const b = await body<{ data?: unknown; cols?: unknown; rows?: unknown }>(req);
      const ok = m[2] === "input" ? typeInConsole(m[1], b.data as string) : resizeConsole(m[1], Number(b.cols), Number(b.rows));
      // Typing in a console is using that session: it moves to the front of the list. The terminal's own reports,
      // sent when the console gets or loses focus or the mouse moves over it, are not typing.
      const used = m[2] === "input" && ok && isTyping(b.data) ? monitor.snapshot?.sessions.find((s) => hostedName(s.tmux) === m![1]) : null;
      if (used) noteUsed(used.sessionId);
      return send(res, 200, { ok, message: ok ? "Sent" : "That console is closed." });
    }
    m = /^\/api\/sessions\/(\d+)\/(approve|reject|answer|focus|ide|close|remote|rename|move|model|effort|mode|place)$/.exec(p);
    if (m) {
      const sessionId = monitor.snapshot?.sessions.find((s) => s.pid === Number(m![1]))?.sessionId;
      const out = await sessionAction(Number(m[1]), m[2], req);
      // Only an action that did something counts as use; a refused one leaves the order alone.
      if (sessionId && USED_BY.has(m[2]) && out && "ok" in out && out.ok) noteUsed(sessionId);
      return send(res, out ? 200 : 404, out ?? { ok: false, message: "Unknown action" });
    }
    switch (p) {
      case "/api/update/check":
        return send(res, 200, await checkForUpdate());
      case "/api/update/run":
        return send(res, 200, startUpdate());
      case "/api/sessions/new":
        return send(res, 200, await newSession(monitor, await body<Parameters<typeof newSession>[1]>(req)));
      case "/api/terminal":
        return send(res, 200, await startTerminal(monitor));
      case "/api/open": {
        const b = await body<{ url?: string; folder?: string; pid?: unknown; account?: unknown }>(req);
        if (b.url) return send(res, 200, await openUrl(b.url, linkEmail(b)));
        const known = (monitor.snapshot?.sessions ?? []).some((s) => b.folder && insidePath(b.folder, s.git?.mainRoot ?? s.cwd));
        if (b.folder && (known || existsSync(b.folder))) return send(res, 200, openFolder(b.folder));
        return send(res, 400, { ok: false, message: "Nothing to open" });
      }
      case "/api/settings": {
        const b = await body<
          Partial<Settings> & {
            addShortcutToken?: string;
            removeShortcutToken?: number;
            addAccount?: { label?: unknown; dir?: unknown };
            renameAccount?: { label?: unknown; dir?: unknown };
            removeAccount?: string;
            savePrompt?: { id?: unknown; title?: unknown; text?: unknown };
            removePrompt?: unknown;
          }
        >(req);
        const patch: Partial<Settings> = {};
        for (const key of ["notifications", "sounds", "aiSummaries", "includeIdePanel"] as const) {
          if (typeof b[key] === "boolean") patch[key] = b[key];
        }
        if (typeof b.inactiveAfterMinutes === "number" && b.inactiveAfterMinutes >= 5) patch.inactiveAfterMinutes = b.inactiveAfterMinutes;
        if (b.layout === "fit" || b.layout === "comfortable" || b.layout === "focus") patch.layout = b.layout;
        if (isIdeId(b.ide)) patch.ide = b.ide;
        if (b.terminalFolder !== undefined) {
          const folder = folderSetting(b.terminalFolder);
          if (!folder) return send(res, 200, { ok: false, message: `No folder at ${String(b.terminalFolder)}` });
          patch.terminalFolder = folder;
        }
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
        if (b.addAccount) {
          const dir = accountDir(b.addAccount.dir);
          const label = accountLabel(b.addAccount.label);
          const accounts = settings().accounts;
          if (!label) return send(res, 200, { ok: false, message: "Give the account a name, such as Personal." });
          if (!dir) return send(res, 200, { ok: false, message: "Pick a folder by its full path, such as ~/.claude-personal. It can't be ~/.claude or in it." });
          const taken = accounts.find((a) => overlaps(a.dir, dir));
          if (taken) return send(res, 200, { ok: false, message: `That folder is ${taken.label}'s, or holds it or sits in it.` });
          if (accounts.length >= MAX_ACCOUNTS) return send(res, 200, { ok: false, message: `Control Room takes up to ${MAX_ACCOUNTS} other accounts.` });
          // Claude Code keeps a login in it, so only you may read it.
          await mkdir(dir, { recursive: true, mode: 0o700 });
          patch.accounts = [...accounts, { label, dir }];
          const connected = await connectLikeUsual({ account: { label, dir }, dir });
          message = `Added ${label}${connected ? ", and connected it so its usage shows here" : ""}. Sign in to it next.`;
          // Asking claude takes a few seconds; the account shows meanwhile, signed in or not once known.
          void readAccount({ label, dir }).then(() => monitor.tick());
        }
        // An empty name gives the usual account its own name back.
        if (b.defaultAccountLabel !== undefined) patch.defaultAccountLabel = accountLabel(b.defaultAccountLabel) ?? "Default";
        if (b.renameAccount) {
          const label = accountLabel(b.renameAccount.label);
          if (!label) return send(res, 200, { ok: false, message: "Give the account a name." });
          if (!settings().accounts.some((a) => a.dir === b.renameAccount!.dir)) return send(res, 200, { ok: false, message: "That account is not in Settings any more." });
          patch.accounts = settings().accounts.map((a) => (a.dir === b.renameAccount!.dir ? { ...a, label } : a));
        }
        if (typeof b.newSessionAccount === "string") {
          if (b.newSessionAccount && !settings().accounts.some((a) => a.dir === b.newSessionAccount)) {
            return send(res, 200, { ok: false, message: "That account is not in Settings any more." });
          }
          patch.newSessionAccount = b.newSessionAccount;
        }
        if (typeof b.removeAccount === "string") {
          const gone = settings().accounts.find((a) => a.dir === b.removeAccount);
          // Its sessions would vanish from here, and those started here would run on with no way to reach them.
          const open = (monitor.snapshot?.sessions ?? []).filter((s) => s.account?.dir === gone?.dir).length;
          if (gone && open) return send(res, 200, { ok: false, message: `Close the ${open} session${open === 1 ? "" : "s"} on ${gone.label} first.` });
          // Once it is out of the list, Disconnect no longer reaches it, so its settings get theirs back now.
          if (gone) {
            const out = await disconnectHome({ account: gone, dir: gone.dir });
            if (!out.ok) return send(res, 200, out);
          }
          patch.accounts = settings().accounts.filter((a) => a.dir !== b.removeAccount);
          // New sessions go back to the usual account.
          if (settings().newSessionAccount === b.removeAccount) patch.newSessionAccount = "";
        }
        if (b.savePrompt) {
          const r = withPrompt(settings().prompts, b.savePrompt, () => randomUUID().slice(0, 8));
          if ("error" in r) return send(res, 200, { ok: false, message: r.error });
          patch.prompts = r.prompts;
          message = `Saved “${r.saved.title}”`;
        }
        if (typeof b.removePrompt === "string") {
          patch.prompts = settings().prompts.filter((p) => p.id !== b.removePrompt);
          message = "Prompt deleted";
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
        if (b.install) await refreshLinkScripts();
        await monitor.tick();
        return send(res, 200, out);
      }
      case "/api/setup/vscode":
        return send(res, 200, await installHelper(VSIX));
      case "/api/account/switch": {
        // Left out, the usual account; else one from Settings, by its folder.
        const b = await body<{ dir?: string }>(req);
        const ref = b.dir ? accountByDir(b.dir) : null;
        if (b.dir && !ref) return send(res, 200, { ok: false, message: "That account is not in Settings any more." });
        return send(res, 200, await startAccountSwitch(ref));
      }
      case "/api/account/refresh":
        await readAccounts();
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

  await Promise.all([cleanOldTaps(), useLoginShellPath()]);
  await Promise.all([readPower(), checkGh(), readAccounts()]);
  await monitor.tick();
  const timers = [
    setInterval(() => void monitor.tick(), 1_200),
    setInterval(() => void readPower(), 30_000),
    setInterval(() => void readAccounts(), 180_000),
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
