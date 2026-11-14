import { SquareTerminal } from "lucide-react";
import { motion } from "motion/react";
import { useEffect } from "react";
import type { Session } from "../../../shared/types.ts";
import { useDragOrder } from "../lib/dragOrder.ts";
import { duration } from "../lib/format.ts";
import { isShell, needsYou, openMenu, setState, useStore } from "../store.ts";
import { StatusOrb, useNow } from "./Primitives.tsx";
import { SessionDetail } from "./SessionDetail.tsx";

/** One session large on the left; every other session as a slim row on the right. */
export function FocusView({ sessions }: { sessions: Session[] }) {
  const selected = useStore((s) => s.selected);
  const all = useStore((s) => s.snapshot?.sessions) ?? sessions;
  const menuPid = useStore((s) => s.menu?.pid);
  const now = useNow();
  // The pick stays on show even when the filter no longer lists it.
  const current = all.find((s) => s.pid === selected) ?? sessions.find(needsYou) ?? sessions[0] ?? null;
  // Whatever is on show becomes the pick, so a re-sort or a new question doesn't swap it.
  useEffect(() => {
    if (current && current.pid !== selected) setState({ selected: current.pid });
  }, [current?.pid, selected]);
  const dragRef = useDragOrder(sessions, ".focus-row", "y");
  return (
    <div className="focus-layout">
      <div className="focus-main">
        {current ? <SessionDetail s={current} variant="focus" /> : <div className="wall-empty"><h3>No session to show</h3></div>}
      </div>
      <nav className="focus-list" aria-label="Sessions" ref={dragRef}>
        {sessions.map((s, i) => (
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
      </nav>
    </div>
  );
}
