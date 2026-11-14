// Your own prompts, saved in Settings: chips in New session, and a menu on each console that pastes one in.
import { isEffort, isMode, isModel } from "./claude.ts";
import type { SavedPrompt } from "./types.ts";

type Tune = Pick<SavedPrompt, "model" | "effort" | "mode">;
const TUNE = { model: isModel, effort: isEffort, mode: isMode } as const;

/** Pure: a prompt's model, effort and mode, each one given, else the one it had, else none ("" = no preference). */
export function promptTune(input: Partial<Record<keyof Tune, unknown>>, had?: Tune): Tune {
  const pick = (k: keyof Tune) => {
    const v = input[k];
    if (v === undefined) return had?.[k] ?? "";
    return TUNE[k](v) ? v : "";
  };
  return { model: pick("model"), effort: pick("effort"), mode: pick("mode") };
}

export const MAX_PROMPTS = 50;
export const MAX_PROMPT_TITLE = 40;
export const MAX_PROMPT_TEXT = 20_000;

/**
 * Pure: a prompt's text as it is saved. Control characters go: the console pastes it into Claude Code, where an
 * Esc could end the paste early, and the rest would arrive as keys, its new lines sending it half done.
 */
export function promptText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
    .trim()
    .slice(0, MAX_PROMPT_TEXT);
}

/** Pure: what its chip says: the title given, else the first few words of its first line. */
export function promptTitle(title: unknown, text: string): string {
  const given = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  if (given) return given.slice(0, MAX_PROMPT_TITLE);
  const words = (text.split("\n").find((l) => l.trim()) ?? "").trim().split(/\s+/).slice(0, 5);
  let out = "";
  for (const w of words) {
    if (`${out} ${w}`.trim().length > MAX_PROMPT_TITLE) break;
    out = `${out} ${w}`.trim();
  }
  return out || text.slice(0, MAX_PROMPT_TITLE); // one long word
}

/** Pure: the saved prompts from a file, each with an id, a title and text, and no two with the same text. */
export function cleanPrompts(raw: unknown): SavedPrompt[] {
  const out: SavedPrompt[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const text = promptText(p?.text);
    const id = typeof p?.id === "string" && /^[\w-]{1,40}$/.test(p.id) ? p.id : null;
    if (!id || !text || out.length >= MAX_PROMPTS || out.some((o) => o.id === id || o.text === text)) continue;
    out.push({ id, title: promptTitle(p.title, text), text, ...promptTune(p) });
  }
  return out;
}

/** Pure: the list with this prompt added at the end, or changed in place when its id is there already. */
export function withPrompt(
  list: SavedPrompt[],
  input: { id?: unknown; title?: unknown; text?: unknown; model?: unknown; effort?: unknown; mode?: unknown },
  newId: () => string,
): { prompts: SavedPrompt[]; saved: SavedPrompt } | { error: string } {
  const text = promptText(input.text);
  if (!text) return { error: "A prompt needs some text." };
  const at = list.findIndex((p) => p.id === input.id);
  const twin = list.find((p) => p.text === text && p.id !== input.id);
  if (twin) return { error: `That prompt is saved already, as “${twin.title}”.` };
  if (at < 0 && list.length >= MAX_PROMPTS) return { error: `You can keep up to ${MAX_PROMPTS} prompts. Delete one in Settings first.` };
  const saved = { id: at < 0 ? newId() : list[at].id, title: promptTitle(input.title, text), text, ...promptTune(input, list[at]) };
  return { prompts: at < 0 ? [...list, saved] : list.map((p, i) => (i === at ? saved : p)), saved };
}

// A slot in a prompt, as in "review <PR URL>": a name that starts with a letter, between < and >, on one line.
const SLOT = /<([A-Za-z][\w .,/'&-]{0,48})>/g;

/** Pure: the slots in a message to fill in before it is sent, each once, in the order they come. */
export function promptSlots(text: string): string[] {
  return [...new Set([...text.matchAll(SLOT)].map((m) => m[1]))];
}

/** Pure: the message with each slot that has a value put in; one left empty stays as it is, for Claude to ask about. */
export function fillSlots(text: string, values: Record<string, string>): string {
  return text.replace(SLOT, (slot, name: string) => values[name]?.trim() || slot);
}

/** Pure: a picked prompt after what you typed yourself, a blank line between. */
export function joinPrompt(base: string, text: string): string {
  return base.trim() ? `${base.trimEnd()}\n\n${text}` : text;
}

/**
 * Pure: the message and picked prompt after a chip is clicked. Another chip takes the place of the one picked before,
 * keeping what you typed ahead of it; the same chip again takes it out. Once you change the message yourself, a chip
 * goes after all of it, so nothing you wrote is lost.
 */
export function pickPrompt<P extends { id: string; text: string }>(
  message: string,
  picked: { prompt: P; base: string } | null,
  p: P,
): { message: string; picked: { prompt: P; base: string } | null } {
  const untouched = picked !== null && message === joinPrompt(picked.base, picked.prompt.text);
  if (untouched && picked.prompt.id === p.id) return { message: picked.base, picked: null };
  const base = untouched ? picked.base : message;
  return { message: joinPrompt(base, p.text), picked: { prompt: p, base } };
}
