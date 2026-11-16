import { Columns2, LayoutGrid, MonitorUp, Rows3 } from "lucide-react";
import { AnimatePresence, LayoutGroup } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, Settings } from "../../../shared/types.ts";
import { useDragOrder } from "../lib/dragOrder.ts";
import { useFolderDrag } from "../lib/folderDrag.ts";
import { withKey } from "../lib/keys.ts";
import { fitWall } from "../lib/layout.ts";
import { native, openWallWindow, type DisplayInfo } from "../lib/native.ts";
import {
  accountChoices,
  accountFilterOf,
  api,
  matchesAccount,
  matchesFilter,
  remember,
  setAccountFilter,
  setState,
  useStore,
  VIEW,
  type Filter,
} from "../store.ts";
import { Monitor } from "./Monitor.tsx";
import { FocusView } from "./FocusView.tsx";
import { MarkBar, useMarks } from "./Marks.tsx";
import { TerminalTile } from "./TerminalTile.tsx";

const GAP = 14;

/** The element's size; a callback ref, so it starts measuring whenever the element appears. */
function useBox<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setBox({ w: rect.width, h: rect.height });
    observer.current = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    observer.current.observe(el);
  }, []);
  return [ref, box];
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs you" },
  { id: "working", label: "Working" },
  { id: "idle", label: "Idle" },
  { id: "inactive", label: "Inactive" },
];

function WallButton() {
  const [displays, setDisplays] = useState<DisplayInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !native) return;
    void native.displays().then(setDisplays);
  }, [open]);
  if (VIEW.wallOnly) {
    return (
      <button type="button" className="seg-btn" onClick={() => native?.toggleFullScreen()} data-tip="Full screen">
        <MonitorUp size={14} /> Full screen
      </button>
    );
  }
  return (
    <div className="menu-wrap">
      <button
        type="button"
        className="seg-btn"
        data-tip="Open the session wall in its own window, on any display"
        onClick={() => (native ? setOpen((o) => !o) : openWallWindow(null))}
      >
        <MonitorUp size={14} /> Wall on display
      </button>
      {open && native && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          <div className="menu-title">Show the wall on</div>
          {(displays ?? []).map((d) => (
            <button
              key={d.id}
              type="button"
              className="menu-item"
              onClick={() => {
                native?.openWall(d.id);
                setOpen(false);
              }}
            >
              <span>{d.label}</span>
              <span className="menu-meta">
                {d.width}×{d.height}
                {d.current ? " · this one" : ""}
              </span>
            </button>
          ))}
          {displays?.length === 1 && <div className="menu-note">Connect another display to spread your sessions across screens.</div>}
        </div>
      )}
    </div>
  );
}

export function WallToolbar({ sessions, layout }: { sessions: Session[]; layout: Settings["layout"] }) {
  const filter = useStore((s) => s.filter);
  const account = useStore(accountFilterOf);
  // A selector must give the same value back each time, so the list is made from the snapshot here.
  const choices = accountChoices(useStore((s) => s.snapshot));
  // The counts are of the account on show.
  const count = (f: Filter) => sessions.filter((s) => matchesAccount(s, account) && matchesFilter(s, f)).length;
  const setLayout = (l: Settings["layout"]) => void api("/api/settings", { layout: l });
  const marks = useMarks();
  return (
    <div className="wall-bar">
      {marks.length > 0 ? (
        <MarkBar count={marks.length} />
      ) : (
        <div className="wall-title">
          <h2>Sessions</h2>
          <span className="wall-sub" data-tip="A session moves to the front when you send it a message or use it here. Drag a card to put it anywhere.">
            last used first · drag to move
          </span>
        </div>
      )}
      <div className="seg" role="tablist" aria-label="Filter sessions">
        {FILTERS.map((f) => {
          const n = count(f.id);
          const attention = f.id === "attention" && n > 0;
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`seg-btn ${filter === f.id ? "is-on" : ""} ${attention ? "is-attention" : ""}`}
              onClick={() => {
                setState({ filter: f.id });
                remember("cr.filter", f.id);
              }}
            >
              {f.label}
              <span className="seg-count">{n}</span>
            </button>
          );
        })}
      </div>
      {choices.length > 0 && (
        <div className="seg" role="tablist" aria-label="Accounts">
          {[{ id: "", label: "All accounts" }, ...choices].map((c) => (
            <button
              key={c.id || "all"}
              type="button"
              role="tab"
              aria-selected={account === c.id}
              className={`seg-btn ${account === c.id ? "is-on" : ""} ${c.id && c.id !== "default" ? "is-account" : ""}`}
              data-tip={c.id === "default" ? "Every session that is not on another account" : undefined}
              onClick={() => setAccountFilter(c.id)}
            >
              {c.label}
              <span className="seg-count">{sessions.filter((s) => matchesAccount(s, c.id)).length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="wall-tools">
        <div className="seg" aria-label="Layout">
          <button type="button" className={`seg-btn ${layout === "fit" ? "is-on" : ""}`} onClick={() => setLayout("fit")} data-tip={withKey("Fit every session on screen", "layout")}>
            <LayoutGrid size={14} /> Fit
          </button>
          <button type="button" className={`seg-btn ${layout === "comfortable" ? "is-on" : ""}`} onClick={() => setLayout("comfortable")} data-tip="Large tiles, scroll for more">
            <Rows3 size={14} /> Large
          </button>
          <button type="button" className={`seg-btn ${layout === "focus" ? "is-on" : ""}`} onClick={() => setLayout("focus")} data-tip={withKey("One session big, the rest beside it", "layout")}>
            <Columns2 size={14} /> Focus
          </button>
        </div>
        <WallButton />
      </div>
    </div>
  );
}

export function Wall({ sessions, layout }: { sessions: Session[]; layout: Settings["layout"] }) {
  const filter = useStore((s) => s.filter);
  const account = useStore(accountFilterOf);
  const selected = useStore((s) => s.selected);
  const shown = sessions.filter((s) => matchesAccount(s, account) && matchesFilter(s, filter));
  const [boxRef, box] = useBox<HTMLDivElement>();
  const dragRef = useDragOrder(shown, ".monitor", "x");
  const folderRef = useFolderDrag(shown, "x");
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      boxRef(el);
      dragRef(el);
      folderRef(el);
    },
    [boxRef, dragRef, folderRef],
  );

  if (layout === "focus") return <FocusView sessions={shown} />;

  // Until the wall is measured, lay tiles out as plain rows instead of a zero-size fit.
  const fit = layout === "fit" && box.w > 0 && box.h > 0 ? fitWall(shown.length, box.w - 6, box.h - 6, GAP) : null;
  const style =
    fit && !fit.scroll
      ? { gridTemplateColumns: `repeat(${fit.cols}, ${fit.tileW}px)`, gridAutoRows: `${fit.tileH}px`, alignContent: "center", justifyContent: "center" }
      : fit
        ? { gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`, gridAutoRows: `${fit.tileH}px` }
        : { gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))", gridAutoRows: "360px" };

  return (
    <div ref={ref} className={`wall ${fit && !fit.scroll ? "is-fit" : "is-scroll"}`}>
      {shown.length === 0 ? (
        <EmptyWall filter={filter} total={sessions.length} />
      ) : (
        <LayoutGroup>
          <div className="wall-grid" style={style}>
            <AnimatePresence mode="popLayout">
              {shown.map((s, i) => {
                const first = s.folder !== null && shown[i - 1]?.folder !== s.folder;
                return s.terminal ? (
                  <TerminalTile key={s.sessionId} s={s} index={i} selected={selected === s.pid} first={first} />
                ) : (
                  <Monitor key={s.sessionId} s={s} index={i} selected={selected === s.pid} first={first} />
                );
              })}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}

function EmptyWall({ filter, total }: { filter: Filter; total: number }) {
  const text =
    total === 0
      ? { title: "No Claude Code sessions are running", body: "Start `claude` in any terminal. It appears here within a second." }
      : filter === "attention"
        ? { title: "Nothing needs you right now", body: "When a session asks for approval or a reply, it shows up here." }
        : { title: "No sessions in this view", body: "Choose “All” to see every session." };
  return (
    <div className="wall-empty">
      <div className="empty-art" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <h3>{text.title}</h3>
      <p>{text.body}</p>
    </div>
  );
}

