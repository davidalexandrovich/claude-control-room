import { SquareTerminal } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, useCallback, useEffect } from "react";
import type { Session } from "../../../shared/types.ts";
import { useDragOrder } from "../lib/dragOrder.ts";
import { useFolderDrag } from "../lib/folderDrag.ts";
import { duration } from "../lib/format.ts";
import { isShell, needsYou, openMenu, setState, useStore } from "../store.ts";
import { FolderHead } from "./Folders.tsx";
import { StatusOrb, useNow } from "./Primitives.tsx";
import { SessionDetail } from "./SessionDetail.tsx";

/**
 * The rows under each folder, in the folders' order, as the list keeps them; those in none come last. A folder no
 * session is in yet shows too, to drag sessions into; one whose sessions this view leaves out does not.
 */
function groups(sessions: Session[], folders: string[], all: Session[]): { folder: string | null; rows: { s: Session; i: number }[] }[] {
  const out = [...folders, null].map((folder) => ({ folder, rows: [] as { s: Session; i: number }[] }));
  sessions.forEach((s, i) => (out.find((g) => g.folder === s.folder) ?? out.at(-1)!).rows.push({ s, i }));
  return out.filter((g) => g.rows.length > 0 || (g.folder !== null && !all.some((s) => s.folder === g.folder)));
}

/** One session large on the left; every other session as a slim row on the right, under its folder. */
export function FocusView({ sessions }: { sessions: Session[] }) {
  const selected = useStore((s) => s.selected);
  const all = useStore((s) => s.snapshot?.sessions) ?? sessions;
  const menuPid = useStore((s) => s.menu?.pid);
  const folded = useStore((s) => s.folded);
  const folders = useStore((s) => s.snapshot?.folders) ?? [];
  const now = useNow();
  // The pick stays on show even when the filter no longer lists it.
  const current = all.find((s) => s.pid === selected) ?? sessions.find(needsYou) ?? sessions[0] ?? null;
  // Whatever is on show becomes the pick, so a re-sort or a new question doesn't swap it.
  useEffect(() => {
    if (current && current.pid !== selected) setState({ selected: current.pid });
  }, [current?.pid, selected]);
  // A row dropped among another folder's rows joins that folder.
  const dragRef = useDragOrder(sessions, ".focus-row", "y", true);
  // A header dragged up or down moves its folder.
  const folderRef = useFolderDrag(sessions, "y");
  const ref = useCallback(
    (el: HTMLElement | null) => {
      dragRef(el);
      folderRef(el);
    },
    [dragRef, folderRef],
  );
  const list = groups(sessions, folders, all);
  return (
    <div className="focus-layout">
      <div className="focus-main">
        {current ? <SessionDetail s={current} variant="focus" /> : <div className="wall-empty"><h3>No session to show</h3></div>}
      </div>
      <nav
        className="focus-list"
        aria-label="Sessions"
        ref={ref}
        onContextMenu={(e) => {
          // On the room around the rows: a menu to make a folder.
          if ((e.target as HTMLElement).closest(".focus-row, .focus-folder")) return;
          e.preventDefault();
          setState({ newFolderAt: { x: e.clientX, y: e.clientY } });
        }}
      >
        {list.map((g) => (
          <Fragment key={g.folder ?? ""}>
            {g.folder !== null ? <FolderHead name={g.folder} sessions={g.rows.map((r) => r.s)} /> : list.length > 1 && <div className="focus-rule" role="separator" />}
            {!(g.folder !== null && folded.includes(g.folder)) &&
              g.rows.map(({ s, i }) => (
                <motion.button
                  layout
                  key={s.sessionId}
                  type="button"
                  className={`focus-row st-${s.activity.kind} ${isShell(s) ? "is-terminal" : ""} ${current?.pid === s.pid ? "is-on" : ""} ${menuPid === s.pid ? "has-menu" : ""}`}
                  onClick={() => setState({ selected: s.pid })}
                  onContextMenu={(e) => openMenu(e, s.pid)}
                  data-pid={s.pid}
                  draggable
                >
                  <span className="mon-key">{i < 9 ? i + 1 : ""}</span>
                  {isShell(s) ? <SquareTerminal size={12} className="term-mark" aria-label="Terminal" /> : <StatusOrb kind={s.activity.kind} size={9} />}
                  <span className="focus-row-text">
                    <span className="focus-row-name">{s.name}</span>
                    <span className="focus-row-status">
                      {s.account && <span className="focus-row-account">{s.account.label} · </span>}
                      {s.activity.label} · {duration(now - s.activity.since)}
                    </span>
                  </span>
                </motion.button>
              ))}
          </Fragment>
        ))}
      </nav>
    </div>
  );
}
