// Drag a session's card or row anywhere in the list. Where it is dropped goes to the server, so every window shows the
// same order. The marks for "it goes here" live on the elements' data attributes: React re-renders the list every
// second, and it leaves attributes it does not know alone.
import { useCallback, useRef } from "react";
import type { Session } from "../../../shared/types.ts";
import { api } from "../store.ts";

type Side = "before" | "after";

/** The card closest to a point: by the distance to its edges, so a gap counts toward the card beside it. */
export function nearest(cards: HTMLElement[], x: number, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

/**
 * A ref for the element that holds the cards (`item` finds them in it); `axis` is how they line up. With `regroup`,
 * a card dropped among another folder's cards joins that folder: the list shows folders under headers then.
 */
export function useDragOrder(sessions: Session[], item: string, axis: "x" | "y", regroup = false): (el: HTMLElement | null) => void {
  const list = useRef(sessions);
  list.current = sessions;
  const detach = useRef<(() => void) | null>(null);

  return useCallback((el: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!el) return;
    let dragged: number | null = null;
    let mark: { el: HTMLElement; pid: number; side: Side } | null = null;

    const items = () => [...el.querySelectorAll<HTMLElement>(item)];
    const pidOf = (node: HTMLElement) => Number(node.dataset.pid);
    const unmark = () => {
      if (mark) delete mark.el.dataset.drop;
      mark = null;
    };

    const start = (e: DragEvent) => {
      // A folder's chip on a card moves the folder (folderDrag.ts), not the card.
      if ((e.target as HTMLElement).closest("[data-folder-drag]")) return;
      const card = (e.target as HTMLElement).closest<HTMLElement>(item);
      if (!card || !el.contains(card) || !e.dataTransfer) return;
      dragged = pidOf(card);
      card.dataset.dragging = "";
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.querySelector("h3, .focus-row-name")?.textContent ?? "");
    };
    const over = (e: DragEvent) => {
      if (dragged === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      // Before or after the card under the pointer, by which half it is in. In a gap between cards, the nearest one
      // counts; past the last row, after the last card.
      const all = items();
      let card = (e.target as HTMLElement).closest<HTMLElement>(item);
      if (!card || !el.contains(card)) card = nearest(all, e.clientX, e.clientY);
      if (!card) return unmark();
      const r = card.getBoundingClientRect();
      let side: Side = (axis === "x" ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2) ? "before" : "after";
      if (e.clientY > Math.max(...all.map((c) => c.getBoundingClientRect().bottom))) [card, side] = [all.at(-1)!, "after"];
      if (pidOf(card) === dragged) return unmark();
      if (mark?.el === card && mark.side === side) return;
      unmark();
      mark = { el: card, pid: pidOf(card), side };
      card.dataset.drop = side;
    };
    const drop = (e: DragEvent) => {
      if (dragged === null) return;
      e.preventDefault();
      const target = mark;
      const pid = dragged;
      end();
      if (!target) return;
      // Its new neighbours, in the list as you see it.
      const rest = list.current.filter((s) => s.pid !== pid);
      const index = rest.findIndex((s) => s.pid === target.pid);
      if (index < 0) return; // the card it was dropped on has left the list meanwhile
      const at = index + (target.side === "after" ? 1 : 0);
      const from = list.current.find((s) => s.pid === pid)?.folder ?? null;
      const into = regroup ? rest[index].folder : from;
      // Only a neighbour in the same folder says where it goes: the order runs on inside each folder.
      const near = (s: Session | undefined) => (s && s.folder === into ? s.pid : null);
      const [above, below] = [near(rest[at - 1]), near(rest[at])];
      // Dropped among another folder's cards where that does not move it there: it stays where it was.
      if (into === from && above === null && below === null) return;
      const place = () => api(`/api/sessions/${pid}/place`, { above, below });
      // Into the folder first, so the place it gets is among its new neighbours.
      void (into !== from ? api(`/api/sessions/${pid}/folder`, { folder: into }).then(place) : place()).catch(() => null);
    };
    const end = () => {
      unmark();
      for (const card of items()) delete card.dataset.dragging;
      dragged = null;
    };
    const leave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) unmark();
    };

    el.addEventListener("dragstart", start);
    el.addEventListener("dragover", over);
    el.addEventListener("drop", drop);
    el.addEventListener("dragend", end);
    el.addEventListener("dragleave", leave);
    detach.current = () => {
      el.removeEventListener("dragstart", start);
      el.removeEventListener("dragover", over);
      el.removeEventListener("drop", drop);
      el.removeEventListener("dragend", end);
      el.removeEventListener("dragleave", leave);
    };
  }, [item, axis, regroup]);
}
