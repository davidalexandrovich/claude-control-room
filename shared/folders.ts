// The list order once sessions are in folders, and where a dragged folder goes. The server sorts by it, and so does the demo.
import type { Session } from "./types.ts";

/** By folder, in the order of `folders`, the sessions in none last; in each, the biggest sort key first. */
export function byFolder(folders: string[]): (a: Session, b: Session) => number {
  const rank = (s: Session) => {
    const i = s.folder === null ? -1 : folders.indexOf(s.folder);
    return i < 0 ? folders.length : i;
  };
  return (a, b) => rank(a) - rank(b) || b.sortKey - a.sortKey || b.startedAt - a.startedAt;
}

/** The folders with `name` moved to just before `before`, or to the end when `before` is null. */
export function movedFolder(names: string[], name: string, before: string | null): string[] {
  if (!names.includes(name) || before === name) return names;
  const rest = names.filter((n) => n !== name);
  const at = before === null ? rest.length : rest.indexOf(before);
  return at < 0 ? names : [...rest.slice(0, at), name, ...rest.slice(at)];
}

/**
 * On the wall: where a folder dropped on card `i` goes, given each card's folder in order. In the first half of that
 * card's folder, before it; in the second half, after it; on a card in no folder, last, since those come last.
 * `mark` is the card that shows the line.
 */
export function wallDrop(folders: (string | null)[], i: number, right: boolean, names: string[]): { before: string | null; mark: number; side: "before" | "after" } {
  const f = folders[i];
  if (f === null) {
    let last = folders.length - 1;
    while (last > 0 && folders[last] === null) last--;
    return { before: null, mark: last, side: "after" };
  }
  let [start, end] = [i, i];
  while (start > 0 && folders[start - 1] === f) start--;
  while (end < folders.length - 1 && folders[end + 1] === f) end++;
  if (i - start + (right ? 0.5 : 0) < (end - start + 1) / 2) return { before: f, mark: start, side: "before" };
  return { before: names[names.indexOf(f) + 1] ?? null, mark: end, side: "after" };
}
