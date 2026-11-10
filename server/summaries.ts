import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AccountRef, Story, Summary } from "../shared/types.ts";
import { claudeEnv } from "./homes.ts";
import { APP_DIR, SUMMARIZER_CWD, SUMMARY_DIR, TICKET_TITLES_FILE } from "./paths.ts";
import { run } from "./proc.ts";

const SYSTEM = `You write status notes about one AI coding session for a dashboard.
The reader may be non-technical and is not a native English speaker.
Rules:
- Plain, everyday English. Short sentences. No jargon.
- Never use code names, file paths, function names, branch names, ticket or PR numbers.
- Say what the work means for the product or the team, not how the code works.
- "headline": what this session works on overall. At most 12 words. No final period.
  Example: "Teaching the assistant to understand dates like 'last week'"
- "now": the latest state in one sentence of at most 20 words: what it just finished,
  what it is doing, or what it needs from the person.
Reply with JSON only: {"headline": "...", "now": "..."}`;

export interface SummaryInput {
  sessionId: string;
  account: AccountRef | null; // the summary runs on the session's own account, never on another one
  basisAt: number; // time of the newest transcript entry the summary covers
  status: string;
  title: string | null;
  story: string | null;
  note: string | null;
  firstPrompt: string | null;
  recent: { role: string; text: string }[];
}

interface Stored {
  headline: string;
  now: string | null;
  at: number;
  basisAt: number;
  status: string;
}

const cache = new Map<string, Stored | null>();
const queue = new Map<string, SummaryInput>();
let running = 0;
const MAX_RUNNING = 2;

function cut(text: string | null, max: number): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function buildPrompt(input: SummaryInput): string {
  const lines = [
    input.title ? `Session title: ${cut(input.title, 120)}` : null,
    input.story ? `Planned task: ${cut(input.story, 200)}` : null,
    input.note ? `Team note: ${cut(input.note, 300)}` : null,
    input.firstPrompt ? `First request from the person:\n${cut(input.firstPrompt, 1500)}` : null,
    `Current status: ${input.status}`,
    "Latest conversation (oldest first):",
    ...input.recent.map((m) => `${m.role === "user" ? "Person" : m.role === "tool" ? "Assistant action" : "Assistant"}: ${cut(m.text, 500)}`),
  ];
  return lines.filter(Boolean).join("\n");
}

export function parseSummary(text: string): { headline: string; now: string | null } | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]);
    if (typeof d.headline !== "string" || !d.headline.trim()) return null;
    return { headline: d.headline.trim().replace(/\.$/, ""), now: typeof d.now === "string" && d.now.trim() ? d.now.trim() : null };
  } catch {
    return null;
  }
}

async function load(sessionId: string): Promise<Stored | null> {
  if (cache.has(sessionId)) return cache.get(sessionId) ?? null;
  try {
    const stored = JSON.parse(await readFile(join(SUMMARY_DIR, `${sessionId}.json`), "utf8")) as Stored;
    cache.set(sessionId, stored);
    return stored;
  } catch {
    cache.set(sessionId, null);
    return null;
  }
}

export async function storedSummary(sessionId: string): Promise<Summary | null> {
  const s = await load(sessionId);
  return s ? { headline: s.headline, now: s.now, source: "ai", updatedAt: s.at } : null;
}

/** Asks for a fresh summary when the session moved on enough since the last one. */
export async function maybeSummarize(input: SummaryInput, opts: { turnJustEnded: boolean; working: boolean }): Promise<void> {
  const prev = await load(input.sessionId);
  const now = Date.now();
  if (prev) {
    if (input.basisAt <= prev.basisAt) return;
    const age = now - prev.at;
    const due = opts.turnJustEnded ? age > 30_000 : opts.working ? age > 4 * 60_000 : age > 10 * 60_000;
    if (!due) return;
  }
  if (!input.recent.length && !input.firstPrompt) return;
  queue.set(input.sessionId, input);
  pump();
}

function pump(): void {
  while (running < MAX_RUNNING && queue.size) {
    const [id, input] = queue.entries().next().value as [string, SummaryInput];
    queue.delete(id);
    running++;
    void summarize(input).finally(() => {
      running--;
      pump();
    });
  }
}

/** One question to haiku, without tools, settings or MCP servers, on the given account: its reply, or null. */
async function askHaiku(system: string, input: string, account: AccountRef | null): Promise<string | null> {
  await mkdir(SUMMARIZER_CWD, { recursive: true });
  const out = await run(
    "claude",
    [
      "-p",
      "--model",
      "haiku",
      "--output-format",
      "json",
      "--tools",
      "",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--system-prompt",
      system,
    ],
    { cwd: SUMMARIZER_CWD, timeoutMs: 90_000, input, env: claudeEnv(account) },
  );
  try {
    const envelope = JSON.parse(out.stdout);
    return !envelope.is_error && typeof envelope.result === "string" ? envelope.result : null;
  } catch {
    return null;
  }
}

async function summarize(input: SummaryInput): Promise<void> {
  const reply = await askHaiku(SYSTEM, buildPrompt(input), input.account);
  const parsed = reply ? parseSummary(reply) : null;
  if (!parsed) return;
  const stored: Stored = { ...parsed, at: Date.now(), basisAt: input.basisAt, status: input.status };
  cache.set(input.sessionId, stored);
  await mkdir(SUMMARY_DIR, { recursive: true });
  await writeFile(join(SUMMARY_DIR, `${input.sessionId}.json`), JSON.stringify(stored) + "\n");
}

// A session on a Shortcut story is named "<story id>-<short title>", the short title after its epic, so the sessions
// of one epic read alike: "27336-Logistics Truck Alerts". Haiku writes it once per story; it is kept on disk.
const TICKET_SYSTEM = `You name Shortcut tickets for a dashboard tile.
Given a story and its epic, write a short title of 2 to 4 words in Title Case.
Name the epic, not the story: its product area and feature, never what this one story adds,
so every story of one epic gets the same title. Example:
Story: 1d | Truck alerts - BE: opt-in (recipients, subscribe/unsubscribe)
Epic: Logistics · Truck alerts (late, arrived, picked up, end-of-day summary)
Title: Logistics Truck Alerts
When there is no epic, or it is a catch-all like "Bug pile", name the story instead, and leave the epic's name out.
Leave out sizes like "1d", team tags like BE or FE, ticket numbers and filler words.
Reply with JSON only: {"title": "..."}`;
const TICKET_PROMPT_ID = createHash("sha256").update(TICKET_SYSTEM).digest("hex").slice(0, 8);

/** Pure: the story's own name without its size ("1d |") or what is in brackets, for when there is no short title. */
export function plainTicketTitle(name: string): string {
  const plain = name
    .replace(/^\s*\d+(\.\d+)?\s*[a-z]{0,2}\s*\|\s*/i, "")
    .replace(/\s*[([][^)\]]*[)\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s.,:;·|-]+$/, "")
    .trim();
  return plain || name.trim();
}

/** Pure: the short title in haiku's reply, or null when it is missing or no short title. */
export function parseTicketTitle(text: string): string | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[0]).title;
    if (typeof raw !== "string") return null;
    const title = raw.replace(/\s+/g, " ").trim().replace(/\.$/, "");
    return title && title.length <= 60 && title.split(" ").length <= 6 ? title : null;
  } catch {
    return null;
  }
}

interface TicketTitle {
  basis: string; // the prompt, story and epic it was written from; a change to any of them asks again
  title: string;
}

let titles: Promise<Map<string, TicketTitle>> | null = null;
let savingTitles: Promise<void> = Promise.resolve();
const askedAt = new Map<number, number>(); // so a story haiku can't name is not asked again on every tick

function ticketTitles(): Promise<Map<string, TicketTitle>> {
  titles ??= readFile(TICKET_TITLES_FILE, "utf8").then(
    (text) => new Map(Object.entries(JSON.parse(text) as Record<string, TicketTitle>)),
    () => new Map(),
  );
  return titles;
}

async function writeTicketTitle(story: Story, basis: string, account: AccountRef | null): Promise<void> {
  const reply = await askHaiku(TICKET_SYSTEM, `Story: ${story.name}\nEpic: ${story.epic ?? "none"}`, account);
  const title = reply ? parseTicketTitle(reply) : null;
  if (!title) return;
  const all = await ticketTitles();
  all.set(String(story.id), { basis, title });
  const save = async () => {
    await mkdir(APP_DIR, { recursive: true });
    const tmp = `${TICKET_TITLES_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(all), null, 2) + "\n");
    await rename(tmp, TICKET_TITLES_FILE);
  };
  savingTitles = savingTitles.then(save, save);
  await savingTitles;
}

/** "<story id>-<short title>". Without AI summaries, or until haiku answers, the story's own name stands in. */
export async function ticketName(story: Story, ai: { account: AccountRef | null } | null): Promise<string> {
  const basis = `${TICKET_PROMPT_ID}\n${story.name}\n${story.epic ?? ""}`;
  const known = (await ticketTitles()).get(String(story.id));
  if (known?.basis !== basis && ai && Date.now() - (askedAt.get(story.id) ?? 0) > 10 * 60_000) {
    askedAt.set(story.id, Date.now());
    void writeTicketTitle(story, basis, ai.account).catch(() => {});
  }
  return `${story.id}-${known?.title ?? plainTicketTitle(story.name)}`;
}
