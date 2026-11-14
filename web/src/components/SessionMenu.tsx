// A session's menu, on a right-click on its tile or row: what its details offer, without opening them.
import {
  AppWindow,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  CodeXml,
  Copy,
  FolderOpen,
  GitPullRequest,
  MonitorDown,
  PanelRight,
  Pencil,
  PictureInPicture2,
  Smartphone,
  SquareKanban,
  SquareTerminal,
  X,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Choice, EFFORTS, MODELS, MODES, modelAlias } from "../../../shared/claude.ts";
import type { Session } from "../../../shared/types.ts";
import { type KeyId, KEYS } from "../lib/keys.ts";
import { popoutSession } from "../lib/native.ts";
import {
  answerable,
  copyResumeCommand,
  copySessionId,
  moveTo,
  reachable,
  remoteBlocked,
  showDetails,
  showInFinder,
  toPhone,
} from "../lib/sessionActions.ts";
import { act, openInIde, openSession, setState, useIdeName, useOpenName, useStore } from "../store.ts";
import { NameEditor, openUrl } from "./Monitor.tsx";
import { StatusOrb } from "./Primitives.tsx";
import { blocked, type What } from "./Tuning.tsx";

const TUNES: { what: What; label: string; choices: Choice[] }[] = [
  { what: "model", label: "Model", choices: MODELS },
  { what: "effort", label: "Effort", choices: EFFORTS },
  { what: "mode", label: "Mode", choices: MODES },
];

// Its tips are native ones: the menu scrolls in a short window, and would clip a drawn tip.

/** The menu shows for the session `st.menu` names, and goes away with it. */
export function SessionMenu() {
  const at = useStore((st) => st.menu);
  const s = useStore((st) => (st.menu && st.snapshot?.sessions.find((x) => x.pid === st.menu!.pid)) || null);
  if (!at || !s) return null;
  return <Menu key={`${at.pid}:${at.x}:${at.y}`} s={s} x={at.x} y={at.y} />;
}

/** One action; `keys` names its shortcut, shown on its right, unless `meta` says something else there. */
function Item(props: { icon: ReactNode; label: string; keys?: KeyId; meta?: string | null; tip?: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  const meta = props.meta !== undefined ? props.meta : props.keys ? KEYS[props.keys].keys[0] : null;
  return (
    <button
      type="button"
      role="menuitem"
      className={`ctx-item ${props.danger ? "is-danger" : ""}`}
      disabled={props.disabled}
      title={props.tip}
      onClick={props.onClick}
    >
      <span className="ctx-icon">{props.icon}</span>
      <span className="ctx-label">{props.label}</span>
      {meta && <span className="ctx-meta">{meta}</span>}
    </button>
  );
}

/** Each choice is one click, so model, effort and mode can all change before the menu closes. */
function TuneRows({ s }: { s: Session }) {
  const busy = useStore((st) => TUNES.find((t) => st.busy[`${s.pid}:${t.what}`])?.what ?? null);
  const current: Record<What, string | null> = { model: modelAlias(s.modelId), effort: s.effort, mode: s.mode === "default" ? "manual" : s.mode };
  // A reason that holds back only some rows names them.
  const reasons = new Map<string, string[]>();
  for (const t of TUNES) {
    const why = blocked(s, t.what);
    if (why) reasons.set(why, [...(reasons.get(why) ?? []), t.label.toLowerCase()]);
  }
  return (
    <>
      {TUNES.map((t) => (
        <div key={t.what} className="ctx-tune" role="radiogroup" aria-label={t.label}>
          <span className="ctx-tune-label">{t.label}</span>
          <div className="ctx-pills">
            {t.choices.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={c.id === current[t.what]}
                className={`ctx-pill ${c.id === current[t.what] ? "is-on" : ""}`}
                title={c.hint || undefined}
                // One change at a time: each types into the same terminal.
                disabled={!!busy || !!blocked(s, t.what)}
                onClick={() => c.id !== current[t.what] && void act(`${s.pid}:${t.what}`, `/api/sessions/${s.pid}/${t.what}`, { [t.what]: c.id })}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {busy ? (
        <div className="ctx-note">Changing the {busy === "mode" ? "permission mode" : busy}…</div>
      ) : (
        [...reasons].map(([why, rows]) => (
          <div key={why} className="ctx-note">
            {rows.length < TUNES.length ? `${rows.join(" and ")[0].toUpperCase()}${rows.join(" and ").slice(1)}: ` : ""}
            {why}
          </div>
        ))
      )}
    </>
  );
}

function Menu({ s, x, y }: { s: Session; x: number; y: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: x, top: y, visibility: "hidden" });
  const [renaming, setRenaming] = useState(false);
  const renamingNow = useRef(false);
  renamingNow.current = renaming;
  const busy = useStore((st) => st.busy);
  const order = useStore((st) => st.snapshot?.sessions);
  const tmuxReady = useStore((st) => st.snapshot?.setup.tmuxReady ?? false);
  const openIn = useOpenName(s);
  const ide = useIdeName();
  const a = s.activity;
  const close = () => setState({ menu: null });
  const run = (fn: () => unknown) => () => {
    close();
    void fn();
  };

  // Where the click was, moved in so all of it shows.
  useLayoutEffect(() => {
    const el = box.current!;
    setStyle({ left: Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8)) });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    // A name being typed saves when its box loses focus; closing first would drop it.
    const gone = () => !renamingNow.current && close();
    const away = (e: Event) => !box.current?.contains(e.target as Node) && gone();
    // Esc closes the menu only, not the details behind it. While renaming, it cancels the new name instead.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || renamingNow.current) return;
      e.preventDefault();
      close();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", gone);
    window.addEventListener("blur", gone);
    // Your scrolling outside closes it; the list scrolling as it sorts itself does not.
    window.addEventListener("wheel", away, { capture: true, passive: true });
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", gone);
      window.removeEventListener("blur", gone);
      window.removeEventListener("wheel", away, true);
    };
  }, []);

  const needsHelper = s.ide === "vscode" && !s.vscodeLinked;

  // Up and down walk the menu, as in any menu; Enter or Space picks. Each item's own key works too: the page's key
  // handler sends it to this session while the menu is open.
  const walk = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...box.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1;
    items[next]?.focus();
  };

  const q = a.question;
  const idle = a.kind === "idle" || a.kind === "inactive";
  const remoteOn = s.remoteUrl !== null;
  const first = order?.[0];
  const last = order?.[order.length - 1];
  const move = async () => {
    const r = (await act(`${s.pid}:move`, `/api/sessions/${s.pid}/move`)) as { ok: boolean; pid?: number };
    if (r.ok && r.pid) setState({ drawer: r.pid, selected: r.pid, typeInto: r.pid });
  };

  return createPortal(
    <div
      ref={box}
      className="menu ctx-menu"
      role="menu"
      aria-label={`${s.name}: actions`}
      tabIndex={-1}
      style={style}
      onKeyDown={walk}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-head">
        {renaming ? <NameEditor s={s} className="ctx-name" onDone={close} /> : <div className="ctx-name">{s.name}</div>}
        <div className="ctx-sub">
          <StatusOrb kind={a.kind} size={8} />
          <span>
            {a.label} · {s.repoName}
          </span>
        </div>
      </div>

      {a.kind === "approval" && reachable(s) && (
        <div className="ctx-group">
          <div className="ctx-ask">{a.tool?.action ?? "A tool wants to run"}</div>
          <Item icon={<Check size={14} />} label="Approve" keys="approve" disabled={busy[`${s.pid}:approve`]} onClick={run(() => act(`${s.pid}:approve`, `/api/sessions/${s.pid}/approve`))} />
          <Item icon={<X size={14} />} label="Reject" keys="reject" disabled={busy[`${s.pid}:reject`]} onClick={run(() => act(`${s.pid}:reject`, `/api/sessions/${s.pid}/reject`))} />
        </div>
      )}
      {answerable(s) && q && (
        <div className="ctx-group">
          {q.question && <div className="ctx-ask">{q.question}</div>}
          {/* Its number is its key. */}
          {q.options.slice(0, 4).map((o, i) => (
            <Item
              key={o.label}
              icon={<span className="ctx-num">{i + 1}</span>}
              label={o.label}
              tip={o.description ?? undefined}
              disabled={busy[`${s.pid}:answer`]}
              onClick={run(() => act(`${s.pid}:answer`, `/api/sessions/${s.pid}/answer`, { option: i }))}
            />
          ))}
        </div>
      )}

      <div className="ctx-group">
        <Item
          icon={s.hosted ? <SquareTerminal size={14} /> : <CodeXml size={14} />}
          label={s.terminal ? "Type in it" : s.hosted ? "Type in its console" : `Open in ${openIn}`}
          keys="open"
          onClick={run(() => openSession(s))}
        />
        {s.hosted && <Item icon={<CodeXml size={14} />} label={`Open in ${ide}`} keys="ide" tip="Open its folder, to see the changes" onClick={run(() => openInIde(s))} />}
        <Item icon={<PanelRight size={14} />} label="Show details" keys="details" onClick={run(() => showDetails(s))} />
        <Item icon={<PictureInPicture2 size={14} />} label="Pop out to its own window" keys="popout" onClick={run(() => popoutSession(s.pid))} />
        <Item
          icon={<Pencil size={14} />}
          label={s.vscodeLinked ? "Rename, on its VS Code tab too" : "Rename"}
          keys="rename"
          tip={needsHelper ? "Renaming a VS Code session needs the VS Code helper (Settings)" : undefined}
          disabled={needsHelper || renaming}
          onClick={() => setRenaming(true)}
        />
      </div>

      {!s.terminal && (
        <div className="ctx-group">
          <TuneRows s={s} />
        </div>
      )}

      <div className="ctx-group">
        {!s.terminal && (
          <Item
            icon={<Smartphone size={14} />}
            label={remoteOn ? "Open on claude.ai" : "Continue on your phone"}
            keys="remote"
            tip={remoteBlocked(s) ?? undefined}
            disabled={busy[`${s.pid}:remote`] || !!remoteBlocked(s)}
            onClick={run(() => toPhone(s))}
          />
        )}
        {s.pr && <Item icon={<GitPullRequest size={14} />} label={`Open PR #${s.pr.number}`} keys="pr" onClick={run(() => openUrl(s.pr!.url, { pid: s.pid }))} />}
        {s.story && <Item icon={<SquareKanban size={14} />} label="Open story" meta={`sc-${s.storyId}`} onClick={run(() => openUrl(s.story!.url, { pid: s.pid }))} />}
        {s.artifacts[0] && (
          <Item icon={<AppWindow size={14} />} label="Open artifact" tip={s.artifacts[0].title ?? undefined} onClick={run(() => openUrl(s.artifacts[0].url, { pid: s.pid }))} />
        )}
        <Item icon={<FolderOpen size={14} />} label="Show folder in Finder" keys="finder" onClick={run(() => showInFinder(s))} />
        {!s.hosted && !s.desktopUrl && tmuxReady && (
          <Item
            icon={<MonitorDown size={14} />}
            label="Move here"
            meta={idle ? null : "once idle"}
            tip="Stop it in its terminal and continue the same conversation here, in a console"
            disabled={!idle || busy[`${s.pid}:move`]}
            onClick={run(move)}
          />
        )}
      </div>

      <div className="ctx-group">
        <Item icon={<ArrowUpToLine size={14} />} label="Move to the front" keys="moveFront" disabled={!first || first.pid === s.pid} onClick={run(() => moveTo(s, "front"))} />
        <Item icon={<ArrowDownToLine size={14} />} label="Move to the end" keys="moveEnd" disabled={!last || last.pid === s.pid} onClick={run(() => moveTo(s, "end"))} />
        {!s.terminal && (
          <>
            <Item
              icon={<Copy size={14} />}
              label="Copy resume command"
              keys="copyResume"
              tip="To continue this conversation in any terminal"
              onClick={run(() => copyResumeCommand(s))}
            />
            <Item icon={<Copy size={14} />} label="Copy session ID" keys="copyId" onClick={run(() => copySessionId(s))} />
          </>
        )}
      </div>

      <div className="ctx-group">
        {!s.desktopUrl && (
          <Item icon={<X size={14} />} label={s.terminal ? "Close terminal…" : "Close session…"} keys="close" danger onClick={run(() => setState({ closing: s.pid }))} />
        )}
      </div>
    </div>,
    document.body,
  );
}
