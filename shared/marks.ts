// Sessions marked to close together: which marks still count, and what the toast says once they are closed.

/** The marked sessions still running, in the list's order. A session that ended drops its mark. */
export function liveMarks(marked: readonly number[], pids: readonly number[]): number[] {
  return pids.filter((pid) => marked.includes(pid));
}

/** One line for all the closes: how many closed, and the first that did not, with why. */
export function closedSummary(total: number, failed: readonly string[]): string {
  if (failed.length === 0) return `Closed ${total} ${total === 1 ? "session" : "sessions"}`;
  const more = failed.length > 1 ? ` (and ${failed.length - 1} more)` : "";
  return `Closed ${total - failed.length} of ${total}. ${failed[0]}${more}`;
}
