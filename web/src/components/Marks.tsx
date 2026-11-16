// Close several sessions at once: tick each one's number box (or ⌘-click it), then Close in the bar above the sessions.
// It closes them one after another, as the × would with its first box only: claims released, worktrees kept.
import { Bot, Check, SquareTerminal, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { closedSummary, liveMarks } from "../../../shared/marks.ts";
import type { ActionResult, Session } from "../../../shared/types.ts";
import { plural } from "../lib/format.ts";
import { api, getState, needsYou, setState, toast, toggleMark, useStore } from "../store.ts";
import { Spinner, StatusOrb } from "./Primitives.tsx";

/** A tile's or a row's number box, which a click ticks. `tip`: what the number does, if it has one. */
export function MarkKey({ s, label, tip }: { s: Session; label: string; tip?: string }) {
  const on = useStore((st) => st.marked.includes(s.pid));
  return (
    <span
      className={`mon-key ${on ? "is-marked" : ""}`}
      role="checkbox"
      aria-checked={on}
      aria-label={`Mark ${s.name}`}
      data-tip={on ? "Marked · click to unmark" : `${tip ? `${tip} · c` : "C"}lick to mark it, to close several at once`}
      onClick={(e) => {
        e.stopPropagation();
        toggleMark(s.pid);
      }}
    >
      {on ? <Check size={12} strokeWidth={3} /> : label}
    </span>
  );
}

/** The marked sessions still running, every one, whatever the filter, the account tab or a shut folder shows. */
export function useMarks(): number[] {
  const marked = useStore((st) => st.marked);
  const sessions = useStore((st) => st.snapshot?.sessions);
  return liveMarks(marked, (sessions ?? []).map((s) => s.pid));
}

/** In place of the wall's title while sessions are marked. */
export function MarkBar({ count }: { count: number }) {
  return (
    <div className="mark-bar" role="toolbar" aria-label="Marked sessions">
      <span className="mark-count">{count} marked</span>
      <button type="button" className="btn btn-sm btn-danger" onClick={() => setState({ closingMarked: true })}>
        <Trash2 size={13} /> Close {count}…
      </button>
      <button type="button" className="btn btn-sm btn-ghost" data-tip="Esc" onClick={() => setState({ marked: [] })}>
        Clear
      </button>
    </div>
  );
}

function Mark({ s }: { s: Session }) {
  if (s.terminal) return s.agent ? <Bot size={12} className="term-mark" /> : <SquareTerminal size={12} className="term-mark" />;
  return <StatusOrb kind={s.activity.kind} size={8} />;
}

/** Asks once for them all, then closes them one by one: two at once in the same repo could trip over its claims. */
export function CloseMarkedDialog() {
  // Taken once: each one leaves the snapshot as it closes, and the list should not shrink under the button.
  const [list] = useState(() => {
    const all = getState().snapshot?.sessions ?? [];
    return liveMarks(getState().marked, all.map((s) => s.pid)).map((pid) => all.find((s) => s.pid === pid)!);
  });
  const [done, setDone] = useState<number | null>(null);
  const running = done !== null;
  const dismiss = () => !running && setState({ closingMarked: false });
  const busy = list.filter((s) => s.activity.kind === "working" || needsYou(s)).length;
  const terminals = list.some((s) => s.terminal && !s.agent);
  // Each one ended before this opened: nothing to ask.
  useEffect(() => {
    if (list.length === 0) setState({ closingMarked: false });
  }, []);

  const submit = async () => {
    setDone(0);
    const failed: string[] = [];
    const closed: number[] = [];
    for (const [i, s] of list.entries()) {
      const out = await api<ActionResult>(`/api/sessions/${s.pid}/close`, { close: true, deleteWorktree: false, force: false }).catch(
        (err: Error) => ({ ok: false, message: `Request failed: ${err.message}` }),
      );
      if (out.ok) closed.push(s.pid);
      else failed.push(`“${s.name}”: ${out.message}`);
      setDone(i + 1);
    }
    toast(closedSummary(list.length, failed), failed.length ? "error" : "ok");
    // The ones that did not close stay marked, to try again.
    setState((st) => ({
      closingMarked: false,
      marked: st.marked.filter((p) => !closed.includes(p)),
      ...(st.drawer !== null && closed.includes(st.drawer) && { drawer: null }),
    }));
  };

  if (list.length === 0) return null;
  return (
    <div className="scrim" onClick={dismiss}>
      <motion.div
        className="dialog"
        role="dialog"
        aria-modal
        aria-labelledby="close-marked-title"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          dismiss();
        }}
      >
        <h2 id="close-marked-title">Close {plural(list.length, "session")}?</h2>
        <p className="dialog-text">
          Each one stops and releases its claims{terminals ? "; a terminal ends with what runs in it" : ""}. Worktrees stay: delete them from This Mac →
          Clean up.
        </p>
        <ul className="mark-list">
          {list.map((s) => {
            const live = s.activity.kind === "working" || needsYou(s);
            return (
              <li key={s.pid} className={live ? "is-live" : ""}>
                <Mark s={s} />
                <span className="mark-list-name">{s.name}</span>
                <span className="mark-list-status">
                  {s.account ? `${s.account.label} · ` : ""}
                  {s.activity.label}
                </span>
              </li>
            );
          })}
        </ul>
        {busy > 0 && <p className="dialog-text tone-warn">{busy === 1 ? "One of them is working or needs you." : `${busy} of them are working or need you.`}</p>}
        <div className="dialog-buttons">
          {/* Cancel has the keyboard, so a stray ↵ closes nothing. */}
          <button type="button" className="btn btn-ghost" disabled={running} autoFocus onClick={dismiss}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" disabled={running} onClick={() => void submit()}>
            {running ? <Spinner /> : null}
            {running ? `Closing ${Math.min(done + 1, list.length)} of ${list.length}…` : `Close ${list.length}`}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
