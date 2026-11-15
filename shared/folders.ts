// The list order once sessions are in folders. The server sorts by it, and so does the demo.
import type { Session } from "./types.ts";

/** By folder, in the order of `folders`, the sessions in none last; in each, the biggest sort key first. */
export function byFolder(folders: string[]): (a: Session, b: Session) => number {
  const rank = (s: Session) => {
    const i = s.folder === null ? -1 : folders.indexOf(s.folder);
    return i < 0 ? folders.length : i;
  };
  return (a, b) => rank(a) - rank(b) || b.sortKey - a.sortKey || b.startedAt - a.startedAt;
}
