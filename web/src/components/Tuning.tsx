// A session's model, effort and permission mode, each a chip that opens a short menu to change it.
import { Check, ChevronDown } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Choice, EFFORTS, MODELS, MODES, modeName, modelAlias } from "../../../shared/claude.ts";
import type { Session } from "../../../shared/types.ts";
import { act, useStore } from "../store.ts";

export type What = "model" | "effort" | "mode";

/** Why `what` can't change from here right now, or null. The server checks again; this says it before you pick. */
export function blocked(s: Session, what: What): string | null {
  if (s.desktopUrl) return `It runs in the Claude app. Change its ${what} there.`;
  if (what === "mode" ? !s.tmux : !s.tmux && !s.vscodeLinked) {
    return what === "mode" && s.vscodeLinked
      ? "Press Shift+Tab in its terminal, or move it here (Move here, in its details)."
      : "Control Room can't type in this terminal. Move it here first (Move here, in its details).";
  }
  const k = s.activity.kind;
  if (k === "approval" || k === "question") return "Answer the session first.";
  if (what !== "mode" && k === "working") return "It changes between turns. Wait until it is idle.";
  return null;
}

/** A menu in its own layer, so no card edge cuts it off. It opens upward when there is no room below. */
export function Popover({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = box.current?.offsetHeight ?? 0;
    const w = box.current?.offsetWidth ?? 0;
    const left = Math.max(8, Math.min(r.left - 8, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom > h + 12;
    setStyle(below ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
  }, [anchor]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    // Esc closes the menu only, not the drawer behind it.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    const gone = () => onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", gone);
    window.addEventListener("scroll", gone, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", gone);
      window.removeEventListener("scroll", gone, true);
    };
  }, [anchor, onClose]);
  // Clicks here must not reach the card underneath, which opens the session's details.
  return createPortal(
    <div ref={box} className="menu tune-menu" style={style} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

function Picker(props: { s: Session; what: What; title: string; tip: string; label: string; current: string | null; choices: Choice[] }) {
  const { s, what } = props;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const busy = useStore((st) => !!st.busy[`${s.pid}:${what}`]);
  const why = blocked(s, what);
  const close = () => setAnchor(null);
  const pick = (id: string) => {
    close();
    if (id !== props.current) void act(`${s.pid}:${what}`, `/api/sessions/${s.pid}/${what}`, { [what]: id });
  };
  return (
    <>
      <button
        type="button"
        className={`foot-item foot-pick ${anchor ? "is-open" : ""} ${busy ? "is-busy" : ""}`}
        data-tip={anchor ? undefined : props.tip}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(anchor ? null : e.currentTarget);
        }}
      >
        {props.label}
        <ChevronDown size={11} className="foot-chev" />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close}>
          <div className="menu-title">{props.title}</div>
          {why && <div className="menu-note">{why}</div>}
          {props.choices.map((c) => (
            <button key={c.id} type="button" role="menuitemradio" aria-checked={c.id === props.current} className="menu-item" disabled={!!why || busy} onClick={() => pick(c.id)}>
              <span className="tune-label">
                <Check size={13} className={c.id === props.current ? "" : "is-hidden"} />
                {c.label}
              </span>
              <span className="menu-meta">{c.hint}</span>
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

/** Model, effort and mode, in the order a card's footer shows them. */
export function TuneChips({ s }: { s: Session }) {
  const mode = s.mode === "default" ? "manual" : s.mode;
  return (
    <>
      <Picker s={s} what="model" title="Model" tip="Model: click to change" label={s.model ?? "—"} current={modelAlias(s.modelId)} choices={MODELS} />
      <span className="foot-dot">·</span>
      <Picker
        s={s}
        what="effort"
        title="Effort"
        tip={s.effortIsDefault ? "Effort (your default): click to change" : "Effort: click to change"}
        label={s.effort ?? "—"}
        current={s.effort}
        choices={EFFORTS}
      />
      <span className="foot-dot">·</span>
      <Picker s={s} what="mode" title="Permission mode" tip="Permission mode: click to change" label={modeName(mode) ?? "mode"} current={mode} choices={MODES} />
    </>
  );
}
