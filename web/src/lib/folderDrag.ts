// Drag a folder to another place among the folders: its header in Focus, up or down; on the wall, the chip on its
// first card, left or right. As with a card's drag (dragOrder.ts), the marks for "it goes here" live on data attributes.
import { useCallback, useRef } from "react";
import { movedFolder, wallDrop } from "../../../shared/folders.ts";
import type { Session } from "../../../shared/types.ts";
import { editFolder, getState } from "../store.ts";
import { nearest } from "./dragOrder.ts";

type Side = "before" | "after";

/** A ref for the element that holds the folders' handles (`[data-folder-drag]`): headers on "y", cards' chips on "x". */
export function useFolderDrag(sessions: Session[], axis: "x" | "y"): (el: HTMLElement | null) => void {
  const list = useRef(sessions);
  list.current = sessions;
  const detach = useRef<(() => void) | null>(null);

  return useCallback(
    (el: HTMLElement | null) => {
      detach.current?.();
      detach.current = null;
      if (!el) return;
      let dragged: string | null = null;
      let mark: { el: HTMLElement; before: string | null; side: Side } | null = null;

      const handles = () => [...el.querySelectorAll<HTMLElement>("[data-folder-drag]")];
      const unmark = () => {
        if (mark) delete mark.el.dataset.drop;
        mark = null;
      };
      // No line where the drop would leave the folders as they are.
      const show = (target: Element | null | undefined, before: string | null, side: Side) => {
        const names = getState().snapshot?.folders ?? [];
        if (!(target instanceof HTMLElement) || dragged === null || movedFolder(names, dragged, before).join("\n") === names.join("\n")) return unmark();
        if (mark?.el === target && mark.side === side && mark.before === before) return;
        unmark();
        mark = { el: target, before, side };
        target.dataset.drop = side;
      };

      const start = (e: DragEvent) => {
        const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-folder-drag]");
        if (!handle || !el.contains(handle) || !e.dataTransfer) return;
        dragged = handle.dataset.folderDrag ?? null;
        handle.dataset.dragging = "";
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragged ?? "");
      };
      const over = (e: DragEvent) => {
        if (dragged === null) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        if (axis === "y") {
          // A header's rows are under it, so the folder goes before the first header below the pointer, by its middle.
          const head = handles().find((h) => {
            const r = h.getBoundingClientRect();
            return r.top + r.height / 2 > e.clientY;
          });
          if (head) return show(head, head.dataset.folderDrag ?? null, "before");
          // Past them all: after the last folder's rows, above the sessions in no folder.
          const rule = el.querySelector(".focus-rule");
          return show(rule ? rule.previousElementSibling : el.lastElementChild, null, "after");
        }
        const cards = [...el.querySelectorAll<HTMLElement>(".monitor")];
        let card = (e.target as HTMLElement).closest<HTMLElement>(".monitor");
        if (!card || !el.contains(card)) card = nearest(cards, e.clientX, e.clientY);
        if (!card) return unmark();
        const folders = cards.map((c) => list.current.find((s) => s.pid === Number(c.dataset.pid))?.folder ?? null);
        const r = card.getBoundingClientRect();
        const to = wallDrop(folders, cards.indexOf(card), e.clientX > r.left + r.width / 2, getState().snapshot?.folders ?? []);
        show(cards[to.mark], to.before, to.side);
      };
      const drop = (e: DragEvent) => {
        if (dragged === null) return;
        e.preventDefault();
        const [name, target] = [dragged, mark];
        end();
        if (target) void editFolder(name, { before: target.before });
      };
      const end = () => {
        unmark();
        for (const h of handles()) delete h.dataset.dragging;
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
    },
    [axis],
  );
}
