// The limits other coding agents report. Codex writes them into its session files on every reply, whether it runs here
// or anywhere else on this Mac; the others keep theirs on their servers, so the UI points to where to look instead.
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { codexLimits } from "../shared/agents.ts";
import type { AgentUsage } from "../shared/types.ts";

const CODEX_SESSIONS = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
const TAIL = 512 * 1024; // the last reply's token_count is near the end
const DAYS = 7; // a session started a week ago and still going is in an older day's folder
const EVERY = 5_000;

let last: { at: number; value: AgentUsage[] } = { at: 0, value: [] };
const parsed = new Map<string, { mtime: number; limits: ReturnType<typeof codexLimits> }>(); // by file, read again once it changes

export async function agentUsages(): Promise<AgentUsage[]> {
  const now = Date.now();
  if (now - last.at < EVERY) return last.value;
  const codex = await codexUsage(now).catch(() => null);
  last = { at: now, value: codex ? [codex] : [] };
  return last.value;
}

async function codexUsage(now: number): Promise<AgentUsage | null> {
  const files = (await recentRollouts()).slice(0, 5);
  for (const file of parsed.keys()) if (!files.some((f) => f.file === file)) parsed.delete(file);
  for (const f of files) {
    const known = parsed.get(f.file);
    const limits = known?.mtime === f.mtime ? known.limits : codexLimits(await tail(f.file));
    parsed.set(f.file, { mtime: f.mtime, limits });
    if (!limits) continue; // no reply yet: the one before has them
    // A window whose reset time passed is stale, the same as Claude's.
    return { id: "codex", label: "Codex", plan: limits.plan, windows: limits.windows.filter((w) => w.resetsAt > now), observedAt: f.mtime };
  }
  return null;
}

/** Codex's session files of the last few days it ran, the one it wrote last first. They sit in folders by year, month and day. */
async function recentRollouts(): Promise<{ file: string; mtime: number }[]> {
  const out: { file: string; mtime: number }[] = [];
  let days = 0;
  walk: for (const y of await numbered(CODEX_SESSIONS))
    for (const m of await numbered(join(CODEX_SESSIONS, y)))
      for (const d of await numbered(join(CODEX_SESSIONS, y, m))) {
        if (days++ >= DAYS) break walk;
        const dir = join(CODEX_SESSIONS, y, m, d);
        for (const name of await readdir(dir).catch(() => [])) {
          if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
          const s = await stat(join(dir, name)).catch(() => null);
          if (s) out.push({ file: join(dir, name), mtime: s.mtimeMs });
        }
      }
  return out.sort((a, b) => b.mtime - a.mtime);
}

async function numbered(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => []);
  return names.filter((n) => /^\d+$/.test(n)).sort((a, b) => Number(b) - Number(a));
}

async function tail(file: string): Promise<string> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const length = Math.min(size, TAIL);
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, size - length);
    return buf.toString("utf8");
  } finally {
    await fh.close();
  }
}
