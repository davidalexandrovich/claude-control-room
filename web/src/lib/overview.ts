// The cards at the top: each one can fold to a chip and come back, and the gaps between them drag to share the width.
// The arrangement is kept on this Mac; the wall view starts with every card folded and keeps nothing.
import { getState, remember, setState, VIEW } from "../store.ts";
import { allHidden, CARDS, type CardId } from "./cards.ts";

const keep = (key: string, value: unknown) => {
  if (!VIEW.wallOnly) remember(key, value);
};

function setHidden(hidden: CardId[], before: CardId[] | null = getState().ovBefore as CardId[] | null): void {
  setState({ ovHidden: hidden, ovBefore: before });
  keep("cr.ovHidden", hidden);
  keep("cr.ovBefore", before);
}

export function minimizeCard(id: CardId): void {
  const hidden = getState().ovHidden as CardId[];
  if (!hidden.includes(id)) setHidden([...hidden, id]);
}

export function restoreCard(id: CardId): void {
  setHidden((getState().ovHidden as CardId[]).filter((x) => x !== id));
}

/** The top bar's ^: every card folds; pressed again, the cards you had open come back, not all of them. */
export function toggleAllCards(): void {
  const hidden = getState().ovHidden as CardId[];
  if (allHidden(hidden)) {
    const before = (getState().ovBefore as CardId[] | null) ?? [];
    setHidden(allHidden(before) ? [] : before, null);
  } else setHidden([...CARDS], hidden);
}

export function setCardWidths(widths: Record<string, number> | null): void {
  setState({ ovWidths: widths ?? {} });
  if (!widths) keep("cr.ovWidths", {});
}

export function keepCardWidths(): void {
  keep("cr.ovWidths", getState().ovWidths);
}
