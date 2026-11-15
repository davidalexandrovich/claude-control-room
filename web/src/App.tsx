import { AnimatePresence, motion } from "motion/react";
import { type PointerEvent as ReactPointerEvent, useEffect } from "react";
import type { Session } from "../../shared/types.ts";
import { CloseDialog } from "./components/CloseDialog.tsx";
import { FolderMenu } from "./components/Folders.tsx";
import { SessionMenu } from "./components/SessionMenu.tsx";
import { NewSessionDialog } from "./components/NewSessionDialog.tsx";
import { KeysPanel } from "./components/KeysPanel.tsx";
import { SessionJump } from "./components/SessionJump.tsx";
import { Overview } from "./components/Overview.tsx";
import { SessionDetail } from "./components/SessionDetail.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { SetupBanner, TopBar } from "./components/TopBar.tsx";
import { Wall, WallToolbar } from "./components/Wall.tsx";
import { WorktreesPanel } from "./components/WorktreesPanel.tsx";
import { type Command, commandOf, isSessionCommand, sessionKeyOf } from "./lib/keys.ts";
import { runSessionKey } from "./lib/sessionActions.ts";
import { clampWidth, dragFrom, type DrawerKind, keepSizes, setDrawerWidth } from "./lib/resize.ts";
import { accountFilterOf, getState, matchesAccount, matchesFilter, openTerminal, setState, type State, useStore, VIEW } from "./store.ts";

function Drawer({ s }: { s: Session | null }) {
  const kind: DrawerKind = s?.hosted ? "wide" : "plain";
  const saved = useStore((st) => st.drawerWidths[kind]);
  const width = saved ? clampWidth(saved) : undefined;
  // Its left edge: drag it like a window's edge. The panel is anchored right, so it grows to the left.
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const w0 = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
    dragFrom(e, "ew-resize", (dx) => setDrawerWidth(kind, w0 - dx));
  };
  const reset = () => {
    setDrawerWidth(kind, null);
    keepSizes();
  };
  return (
    <AnimatePresence>
      {s && (
        <>
          <motion.div className="drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setState({ drawer: null })} />
          <motion.aside
            className={`drawer ${s.hosted ? "is-wide" : ""}`}
            style={width ? { width } : undefined}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
          >
            <div className="drawer-grip" data-tip="Drag to resize · double-click for the usual width" onPointerDown={startDrag} onDoubleClick={reset} />
            <SessionDetail s={s} variant="drawer" />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// Keys typed for another app can land here when this window takes focus, so the first moment is ignored.
let focusedAt = Date.now();
window.addEventListener("focus", () => (focusedAt = Date.now()));

/** Moves the pick. Open details follow it, and a console that had the keyboard hands it to the next one's. */
function select(s: Session | undefined): void {
  if (!s) return;
  const typing = !!(document.activeElement as HTMLElement | null)?.closest(".xterm");
  setState((st) => ({ selected: s.pid, ...(st.drawer !== null && { drawer: s.pid }), ...(typing && s.hosted && { typeInto: s.pid }) }));
  requestAnimationFrame(() => document.querySelector(`.wall-area [data-pid="${s.pid}"]`)?.scrollIntoView({ block: "nearest" }));
}

/** One step along the sessions, round from the last to the first, as tabs go. */
function step(visible: Session[], pid: number | null, by: 1 | -1): Session | undefined {
  const i = visible.findIndex((s) => s.pid === pid);
  if (i < 0) return by > 0 ? visible[0] : visible.at(-1);
  return visible[(i + by + visible.length) % visible.length];
}

/** The session above or below the picked one, by where its tile sits: a row up or down the grid, or along the list in Focus. */
function byPlace(visible: Session[], pid: number | null, by: 1 | -1): Session | undefined {
  const tiles = [...document.querySelectorAll<HTMLElement>(".wall-area [data-pid]")];
  const at = tiles.find((t) => Number(t.dataset.pid) === pid)?.getBoundingClientRect();
  if (!at) return visible[0];
  let best: { pid: number; score: number } | null = null;
  for (const t of tiles) {
    const r = t.getBoundingClientRect();
    const dy = (r.top - at.top) * by;
    if (dy < at.height / 2) continue; // the same row, or the other way
    const score = dy * 10_000 + Math.abs(r.left - at.left); // the nearest row first, then the nearest in it
    if (!best || score < best.score) best = { pid: Number(t.dataset.pid), score };
  }
  const found = best?.pid;
  return visible.find((s) => s.pid === found);
}

/** The shortcuts that work everywhere, a console included. */
function command(cmd: Command, visible: Session[], st: State): void {
  // A close waits for its answer, and the new-session dialog may hold a console that still waits for one.
  if (st.closing || st.panel === "new") return;
  if (cmd.id === "newSession") return void (!VIEW.wallOnly && setState({ panel: "new" }));
  if (cmd.id === "newTerminal") return void (!VIEW.wallOnly && openTerminal());
  if (cmd.id === "settings") return setState({ panel: st.panel === "settings" ? null : "settings" });
  if (cmd.id === "help") return setState({ panel: st.panel === "keys" ? null : "keys" });
  if (cmd.id === "jump") return setState({ panel: st.panel === "jump" ? null : "jump" });
  if (cmd.id === "leave") return (document.activeElement as HTMLElement | null)?.blur();
  if (st.panel) return;
  if (cmd.id === "pick") return select(visible[cmd.n - 1]);
  if (isSessionCommand(cmd)) {
    const s = visible.find((x) => x.pid === st.selected);
    return void (s && runSessionKey(cmd, s));
  }
  select(step(visible, st.selected, cmd.id === "next" ? 1 : -1));
}

/**
 * A session's menu is open: the keys act on its session, as a menu's shortcuts do, and close it. A name being typed in
 * it, and Enter or Space on the item the arrows reached, stay the menu's own.
 */
function menuKey(e: KeyboardEvent, st: State): void {
  const s = st.snapshot?.sessions.find((x) => x.pid === st.menu?.pid);
  const target = e.target as HTMLElement;
  if (!s || target.closest("input") || ((e.key === "Enter" || e.key === " ") && target.closest(".ctx-menu button"))) return;
  const cmd = commandOf(e);
  const k = cmd ? (isSessionCommand(cmd) ? cmd : null) : sessionKeyOf(e, true);
  if (!k) return;
  e.preventDefault();
  if (runSessionKey(k, s)) setState({ menu: null });
}

function useKeyboard(visible: Session[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An open menu took this key already.
      if (e.defaultPrevented) return;
      const st = getState();
      if (st.menu) return menuKey(e, st);
      const target = e.target as HTMLElement;
      const cmd = commandOf(e);
      // In a text box, ⌘↑ and ⌘↓ move its cursor, as always. The console's hidden box is not one of those.
      const caret = e.metaKey && (cmd?.id === "next" || cmd?.id === "prev") && !!target.closest("input, textarea") && !target.closest(".xterm");
      if (cmd && !caret) {
        e.preventDefault();
        return command(cmd, visible, st);
      }
      if (target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        // The new-session dialog decides for itself: it may hold a console that still waits for an answer.
        if (st.panel === "new") return;
        // A maximized console steps back to the details first. Esc inside the console still goes to Claude Code.
        if (st.drawer && st.consoleView === "max" && !st.closing && !st.panel) return setState({ consoleView: "normal" });
        setState(st.closing ? { closing: null } : st.panel ? { panel: null } : { drawer: null });
        return;
      }
      if (!document.hasFocus() || Date.now() - focusedAt < 900) return;
      if (st.closing || st.panel) return;
      if (e.key === "?") return setState({ panel: "keys" });
      if (/^[1-9]$/.test(e.key)) return select(visible[Number(e.key) - 1]);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        return select(step(visible, st.selected, e.key === "ArrowRight" ? 1 : -1));
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); // the wall would scroll as well
        return select(byPlace(visible, st.selected, e.key === "ArrowDown" ? 1 : -1));
      }
      if ((e.key === "Home" || e.key === "End") && !e.shiftKey) {
        e.preventDefault();
        return select(e.key === "Home" ? visible[0] : visible.at(-1));
      }
      if (e.key.toLowerCase() === "n" && !VIEW.wallOnly) {
        setState({ panel: "new" });
        return;
      }
      if (e.key.toLowerCase() === "t" && !VIEW.wallOnly) {
        void openTerminal();
        return;
      }
      if (e.key.toLowerCase() === "f") {
        const layout = st.snapshot?.settings.layout === "focus" ? "fit" : "focus";
        void fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json", "X-Control-Room": "1" }, body: JSON.stringify({ layout }) });
        return;
      }
      const s = visible.find((x) => x.pid === st.selected);
      const k = sessionKeyOf(e);
      // An Enter would otherwise reach the console that opens now, and a Space scroll the wall.
      if (s && k && runSessionKey(k, s)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);
}

function Loading() {
  return (
    <div className="boot">
      <div className="empty-art" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <p>Looking for your Claude Code sessions…</p>
    </div>
  );
}

/** A single session in its own window, for a second display. */
function SessionWindow({ pid }: { pid: number }) {
  const snap = useStore((s) => s.snapshot);
  const closing = useStore((s) => s.closing);
  const s = snap?.sessions.find((x) => x.pid === pid) ?? null;
  useEffect(() => {
    if (s) document.title = `${s.name} · Control Room`;
  }, [s?.name]);
  if (!snap) return <Loading />;
  if (!s) return <div className="boot"><p>This session has ended.</p></div>;
  return (
    <div className="app app-popout">
      <TopBar snap={snap} />
      <SessionDetail s={s} variant="popout" />
      {closing === s.pid && <CloseDialog s={s} />}
      <Toasts />
    </div>
  );
}

export function App() {
  const snap = useStore((s) => s.snapshot);
  const filter = useStore((s) => s.filter);
  const drawer = useStore((s) => s.drawer);
  const closing = useStore((s) => s.closing);
  const panel = useStore((s) => s.panel);
  const account = useStore(accountFilterOf);
  const visible = (snap?.sessions ?? []).filter((s) => matchesAccount(s, account) && matchesFilter(s, filter));
  useKeyboard(visible);

  if (VIEW.sessionPid !== null) return <SessionWindow pid={VIEW.sessionPid} />;
  if (!snap) return <Loading />;
  const byPid = (pid: number | null) => (pid === null ? null : (snap.sessions.find((s) => s.pid === pid) ?? null));
  const closingSession = byPid(closing);
  return (
    <div className={`app ${VIEW.wallOnly ? "app-wall" : ""}`}>
      <TopBar snap={snap} />
      <SetupBanner snap={snap} />
      <Overview snap={snap} />
      <main className="wall-area">
        <WallToolbar sessions={snap.sessions} layout={snap.settings.layout} />
        <Wall sessions={snap.sessions} layout={snap.settings.layout} />
      </main>
      <Drawer s={snap.settings.layout === "focus" ? null : byPid(drawer)} />
      {closingSession && <CloseDialog s={closingSession} />}
      {panel === "settings" && <SettingsPanel snap={snap} />}
      {panel === "worktrees" && <WorktreesPanel />}
      {panel === "new" && <NewSessionDialog snap={snap} />}
      {panel === "keys" && <KeysPanel />}
      {panel === "jump" && <SessionJump />}
      <SessionMenu />
      <FolderMenu />
      <Toasts />
    </div>
  );
}
