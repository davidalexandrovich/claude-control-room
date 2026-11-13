// Sizes you set by dragging an edge: the details panel's width and the console's height. They live in the store, so
// the panel's edge and the console's edges move the same thing, and on this Mac for next time.
import { getState, remember, setState } from "../store.ts";
import { keepCardWidths } from "./overview.ts";

export const DRAWER_MIN = 420;
const CONSOLE_MIN = 140;

export type DrawerKind = "wide" | "plain"; // with a console, and without one

export const clampWidth = (w: number) => Math.round(Math.max(DRAWER_MIN, Math.min(window.innerWidth - 80, w)));
export const clampHeight = (h: number) => Math.round(Math.max(CONSOLE_MIN, Math.min(window.innerHeight - 140, h)));

/** Follows the pointer from `e` until it is let go anywhere in the window, then keeps the sizes. */
export function dragFrom(e: { button: number; clientX: number; clientY: number; preventDefault(): void }, cursor: string, move: (dx: number, dy: number) => void): void {
  if (e.button !== 0) return;
  e.preventDefault();
  const x0 = e.clientX;
  const y0 = e.clientY;
  document.body.classList.add("is-resizing");
  document.body.style.cursor = cursor;
  const onMove = (ev: PointerEvent) => move(ev.clientX - x0, ev.clientY - y0);
  const up = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    document.body.classList.remove("is-resizing");
    document.body.style.cursor = "";
    keepSizes();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

export function setDrawerWidth(kind: DrawerKind, width: number | null): void {
  setState((st) => {
    const { [kind]: _, ...rest } = st.drawerWidths;
    return { drawerWidths: width === null ? rest : { ...rest, [kind]: clampWidth(width) } };
  });
}

export function setConsoleHeight(height: number | null): void {
  setState({ consoleHeight: height === null ? null : clampHeight(height) });
}

export function keepSizes(): void {
  const st = getState();
  remember("cr.drawerWidths", st.drawerWidths);
  remember("cr.consoleHeight", st.consoleHeight);
  keepCardWidths();
}
