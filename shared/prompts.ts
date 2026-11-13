// Your own prompts, saved in Settings: chips in New session, and a menu on each console that pastes one in.
import type { SavedPrompt } from "./types.ts";

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
    out.push({ id, title: promptTitle(p.title, text), text });
  }
  return out;
}

/** Pure: the list with this prompt added at the end, or changed in place when its id is there already. */
export function withPrompt(
  list: SavedPrompt[],
  input: { id?: unknown; title?: unknown; text?: unknown },
  newId: () => string,
): { prompts: SavedPrompt[]; saved: SavedPrompt } | { error: string } {
  const text = promptText(input.text);
  if (!text) return { error: "A prompt needs some text." };
  const at = list.findIndex((p) => p.id === input.id);
  const twin = list.find((p) => p.text === text && p.id !== input.id);
  if (twin) return { error: `That prompt is saved already, as “${twin.title}”.` };
  if (at < 0 && list.length >= MAX_PROMPTS) return { error: `You can keep up to ${MAX_PROMPTS} prompts. Delete one in Settings first.` };
  const saved = { id: at < 0 ? newId() : list[at].id, title: promptTitle(input.title, text), text };
  return { prompts: at < 0 ? [...list, saved] : list.map((p, i) => (i === at ? saved : p)), saved };
}
