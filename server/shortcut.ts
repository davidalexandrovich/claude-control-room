import type { Story } from "../shared/types.ts";
import { settings } from "./config.ts";

const API = "https://api.app.shortcut.com/api/v3";
const STORY_RE = /(?:\bsc-|app\.shortcut\.com\/[\w-]+\/story\/)(\d{3,7})\b/gi;

/** The first story id found, trying sources in order; inside one source the most named id wins. */
export function findStoryId(sources: (string | null | undefined)[]): number | null {
  for (const text of sources) {
    if (!text) continue;
    const counts = new Map<number, number>();
    for (const m of text.matchAll(STORY_RE)) {
      const id = Number(m[1]);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (counts.size) return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return null;
}

interface TokenMeta {
  states: Map<number, string>;
  members: Map<string, string>;
  at: number;
}

const stories = new Map<number, { at: number; story: Story | null; loading: boolean }>();
const metas = new Map<string, TokenMeta>();
const epics = new Map<number, { name: string | null; at: number }>();
let lastOk = false;

export function shortcutReady(): boolean {
  return settings().shortcutTokens.length > 0 && lastOk;
}

async function call(token: string, path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Shortcut-Token": token, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw Object.assign(new Error(`Shortcut ${res.status}`), { status: res.status });
  return res.json();
}

async function meta(token: string): Promise<TokenMeta> {
  const hit = metas.get(token);
  if (hit && Date.now() - hit.at < 3_600_000) return hit;
  const [workflows, members] = await Promise.all([call(token, "/workflows"), call(token, "/members")]);
  const states = new Map<number, string>();
  for (const wf of workflows ?? []) for (const s of wf.states ?? []) states.set(s.id, s.name);
  const people = new Map<string, string>();
  for (const m of members ?? []) people.set(m.id, m.profile?.name ?? m.profile?.mention_name ?? "");
  const value = { states, members: people, at: Date.now() };
  metas.set(token, value);
  return value;
}

async function epicName(token: string, id: number): Promise<string | null> {
  const hit = epics.get(id);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.name;
  const name = ((await call(token, `/epics/${id}`).catch(() => null))?.name as string | undefined) ?? null;
  epics.set(id, { name, at: Date.now() });
  return name;
}

async function load(id: number): Promise<Story | null> {
  for (const token of settings().shortcutTokens) {
    try {
      const raw = await call(token, `/stories/${id}`);
      const m = await meta(token);
      lastOk = true;
      return {
        id,
        name: raw.name ?? "",
        state: m.states.get(raw.workflow_state_id) ?? null,
        url: raw.app_url ?? `https://app.shortcut.com/story/${id}`,
        type: raw.story_type ?? null,
        owners: (raw.owner_ids ?? []).map((o: string) => m.members.get(o)).filter(Boolean),
        epic: typeof raw.epic_id === "number" ? await epicName(token, raw.epic_id) : null,
      };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) continue; // this token belongs to another workspace or is wrong
      if (status === 404) continue;
    }
  }
  return null;
}

/** Cached story, refreshed every five minutes in the background. */
export function story(id: number | null): Story | null {
  if (id === null || settings().shortcutTokens.length === 0) return null;
  const hit = stories.get(id);
  if (!hit || (!hit.loading && Date.now() - hit.at > 300_000)) {
    const entry = { at: hit?.at ?? 0, story: hit?.story ?? null, loading: true };
    stories.set(id, entry);
    void load(id).then((s) => {
      entry.story = s ?? entry.story;
      entry.at = Date.now();
      entry.loading = false;
    });
  }
  return hit?.story ?? null;
}

export function forgetStories(): void {
  stories.clear();
  metas.clear();
  epics.clear();
}

export async function testToken(token: string): Promise<{ ok: boolean; message: string }> {
  try {
    const me = await call(token, "/member");
    return { ok: true, message: `Connected to Shortcut workspace "${me.workspace2?.url_slug ?? me.workspace2?.name ?? "?"}"` };
  } catch (err) {
    return { ok: false, message: `Shortcut refused the token (${(err as Error).message})` };
  }
}
