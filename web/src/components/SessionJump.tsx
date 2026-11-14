// ⌘K: go to a session by whatever you remember of it. Its console, when it has one, takes the keyboard.
import { SquareTerminal } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Session } from "../../../shared/types.ts";
import { isShell, setState, useStore } from "../store.ts";
import { StatusOrb } from "./Primitives.tsx";

function words(s: Session): string {
  return [s.name, s.repoName, s.git?.branch, s.account?.label, s.summary.headline].filter(Boolean).join(" ").toLowerCase();
}

export function SessionJump() {
  const sessions = useStore((st) => st.snapshot?.sessions) ?? [];
  const focus = useStore((st) => st.snapshot?.settings.layout === "focus");
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  // Every word typed must be somewhere in what it is called or works on, in any order.
  const typed = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = sessions.filter((s) => typed.every((w) => words(s).includes(w)));
  const pick = Math.max(0, Math.min(at, found.length - 1));
  const close = () => setState({ panel: null });
  const go = (s: Session) => setState({ panel: null, selected: s.pid, ...(!focus && { drawer: s.pid }), ...(s.hosted && { typeInto: s.pid }) });

  // Braces: scrollIntoView returns a promise now, and an effect may return only its cleanup.
  useEffect(() => {
    void document.querySelector(".jump-row.is-on")?.scrollIntoView({ block: "nearest" });
  }, [pick, query]);

  return (
    <div className="scrim scrim-top" onClick={close}>
      <motion.div
        className="dialog jump"
        role="dialog"
        aria-modal
        aria-label="Go to a session"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 520, damping: 38 }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="input jump-input"
          autoFocus
          placeholder="Go to a session: part of its name, repo or branch"
          aria-label="Session to go to"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setAt(Math.max(0, Math.min(found.length - 1, pick + (e.key === "ArrowDown" ? 1 : -1))));
            } else if (e.key === "Enter" && found[pick]) {
              e.preventDefault();
              go(found[pick]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <div className="jump-list" role="listbox" aria-label="Sessions">
          {found.map((s, i) => (
            <button
              key={s.sessionId}
              type="button"
              role="option"
              aria-selected={i === pick}
              className={`jump-row ${i === pick ? "is-on" : ""}`}
              onMouseMove={() => i !== pick && setAt(i)}
              onClick={() => go(s)}
            >
              {isShell(s) ? <SquareTerminal size={13} className="term-mark" aria-label="Terminal" /> : <StatusOrb kind={s.activity.kind} size={9} />}
              <span className="jump-name">{s.name}</span>
              <span className="jump-sub">
                {s.account && <span className="focus-row-account">{s.account.label} · </span>}
                {s.activity.label} · {s.repoName}
              </span>
            </button>
          ))}
          {!found.length && <p className="jump-empty muted">No session matches “{query}”.</p>}
        </div>
        <p className="jump-foot muted">↑ ↓ to choose · ↵ to go · Esc to close</p>
      </motion.div>
    </div>
  );
}
