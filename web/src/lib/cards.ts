// The cards at the top, and how they share the row: pure, so the tests can run it without a page.
export const CARDS = ["sessions", "attention", "prs", "usage", "mac"] as const;
export type CardId = (typeof CARDS)[number];

/** How wide each card is at least, and its share of the row until you drag a gap. */
export const CARD_SIZE: Record<CardId, { min: number; share: number }> = {
  sessions: { min: 200, share: 0.9 },
  attention: { min: 280, share: 1.3 },
  prs: { min: 260, share: 1.3 },
  usage: { min: 290, share: 1.3 },
  mac: { min: 250, share: 1.05 },
};

export const allHidden = (hidden: readonly string[]) => CARDS.every((id) => hidden.includes(id));

/** Pure: the grid's columns for the cards that show, each its dragged width or its usual share, then the tray. */
export function cardColumns(visible: CardId[], widths: Record<string, number>, tray: boolean): string {
  const cols = visible.map((id) => `minmax(${CARD_SIZE[id].min}px, ${widths[id] ?? CARD_SIZE[id].share * 300}fr)`);
  return [...cols, ...(tray ? ["max-content"] : [])].join(" ");
}

/** Pure: two neighbours' new widths after their gap moved by dx, each kept at its least; their sum stays the same. */
export function dragGap(left: { w: number; min: number }, right: { w: number; min: number }, dx: number): [number, number] {
  const sum = left.w + right.w;
  const l = Math.max(left.min, Math.min(sum - right.min, left.w + dx));
  return [l, sum - l];
}
