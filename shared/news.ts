// The daily AI news: the day it is for, when a run is due, and reading Claude's reply. Whatever the reply holds came
// from web pages, so only plain text and web links get through, and the UI shows them as text.
import type { NewsItem } from "./types.ts";

export const NEWS_ITEMS = 5;
// Automatic runs a day, so a run that keeps failing can't eat an account's usage.
export const NEWS_TRIES = 3;

/** The local date, YYYY-MM-DD: the day ends at midnight here, not in UTC. */
export function localDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whether to run today, on its own: none made today yet, none running, and tries left. */
export function newsDue(st: { latest: string | null; tries: { date: string; n: number }; running: boolean }, today: string): boolean {
  if (st.running || st.latest === today) return false;
  return st.tries.date !== today || st.tries.n < NEWS_TRIES;
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t && t.length <= max ? t : null;
}

// Case and spacing aside, so "Claude Code 2.1.325: X" and "claude code 2.1.325:  x" are the same pick.
const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** The picks in Claude's reply: up to five, each with a title, a summary and a web link. Null: none.
 *  A pick an earlier day had by its title is left out. Its link alone isn't, since a changelog keeps one link for every release. */
export function parseNews(reply: string, seen: readonly Pick<NewsItem, "title" | "url">[] = []): NewsItem[] | null {
  const m = /\{[\s\S]*\}/.exec(reply);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const list = (raw as { items?: unknown })?.items;
  if (!Array.isArray(list)) return null;
  const out: NewsItem[] = [];
  for (const it of list) {
    const r = (it ?? {}) as Record<string, unknown>;
    const title = text(r.title, 140);
    const summary = text(r.summary, 700);
    const url = typeof r.url === "string" ? r.url.trim() : "";
    if (!title || !summary || !/^https?:\/\/[^\s"<>]+$/i.test(url) || url.length > 600) continue;
    if (seen.some((o) => same(o.title, title)) || out.some((o) => o.url === url)) continue;
    out.push({ title, summary, url, tag: text(r.tag, 24) ?? "" });
    if (out.length === NEWS_ITEMS) break;
  }
  return out.length ? out : null;
}

/** "openai.com" from its link, for the line under a pick. */
export function sourceOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
