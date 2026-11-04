import { ArrowUpRight, Bell, BellOff, ChevronDown, CodeXml, Coffee, Ellipsis, LayoutDashboard, Monitor as Screen, Moon, Volume2, VolumeX } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { RateWindow, Session, Snapshot } from "../../../shared/types.ts";
import { playChime } from "../lib/alerts.ts";
import { duration, plural } from "../lib/format.ts";
import { native, openWallWindow } from "../lib/native.ts";
import { act, api, needsYou, useIdeName, useStore } from "../store.ts";
import { ApprovalCard, lastWords, openUrl, PrChip, QuestionCard, RemoteButton, taskLine } from "./Monitor.tsx";
import { GROUPS } from "./Overview.tsx";
import { Meter, Spinner, StatusOrb, useNow } from "./Primitives.tsx";
import { Toasts } from "./Toasts.tsx";
import { Logo } from "./TopBar.tsx";

function openDashboard(pid: number | null): void {
  if (native) native.openMain(pid);
  else window.open("/", "cr-main");
}

function focusSession(s: Session): void {
  void act(`${s.pid}:focus`, `/api/sessions/${s.pid}/focus`, {}, true);
  native?.hidePanel();
}

function Head({ sessions }: { sessions: Session[] }) {
  const connected = useStore((s) => s.connected);
  const counts = GROUPS.map((g) => sessions.filter((s) => g.kinds.includes(s.activity.kind)).length);
  return (
    <header className="mb-head">
      <div className="mb-brand">
        <Logo size={18} />
        <b>Control Room</b>
        <span className={`live ${connected ? "is-on" : ""}`}>
          <span className="live-dot" />
          {connected ? "Live" : "Offline"}
        </span>
        <button type="button" className="mb-icon is-shown" aria-label="More" onClick={() => native?.showMenu("more")}>
          <Ellipsis size={16} />
        </button>
      </div>
      {sessions.length > 0 && (
        <>
          <div className="mb-bar" aria-hidden>
            {GROUPS.map((g, i) => (counts[i] ? <span key={g.id} style={{ flexGrow: counts[i], background: g.color }} /> : null))}
          </div>
          <div className="mb-legend">
            {GROUPS.map((g, i) => (
              <span key={g.id} className={counts[i] ? "" : "is-zero"}>
                <i style={{ background: g.color }} />
                <b>{counts[i]}</b> {g.label}
              </span>
            ))}
          </div>
        </>
      )}
    </header>
  );
}

function AskCard({ s }: { s: Session }) {
  const now = useNow();
  const ide = useIdeName();
  const a = s.activity;
  const words = a.kind === "idle" ? lastWords(s) : null;
  return (
    <div className="mb-ask">
      <button type="button" className="mb-ask-head" onClick={() => openDashboard(s.pid)}>
        <StatusOrb kind={a.kind} size={9} />
        <span className="mb-name">{s.name}</span>
        <span className="mb-time">{duration(now - a.since)}</span>
      </button>
      {a.kind === "approval" ? (
        <ApprovalCard s={s} />
      ) : a.kind === "question" ? (
        <QuestionCard s={s} />
      ) : (
        <div className="ask-card">
          <div className="ask-what">{a.label}</div>
          {(words?.text ?? a.detail) && <div className="mb-ask-words">{words?.text ?? a.detail}</div>}
          <div className="ask-buttons">
            <button type="button" className="btn btn-approve btn-sm" onClick={() => focusSession(s)}>
              Reply in {ide}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusWord(s: Session): string {
  return s.activity.kind === "background" ? "Background task" : s.activity.label;
}

function Row({ s }: { s: Session }) {
  const now = useNow();
  const ide = useIdeName();
  const a = s.activity;
  return (
    <div className={`mb-row st-${a.kind}`} role="button" tabIndex={0} onClick={() => openDashboard(s.pid)} onKeyDown={(e) => e.key === "Enter" && openDashboard(s.pid)}>
      <StatusOrb kind={a.kind} size={9} />
      <span className="mb-name">{s.name}</span>
      <span className="mb-status">
        {statusWord(s)} · {duration(now - a.since)}
      </span>
      <span className="mb-task">{taskLine(s) || s.repoName}</span>
      <span className="mb-tools">
        {s.pr && <PrChip pr={s.pr} />}
        <RemoteButton s={s} look="icon" />
        <button
          type="button"
          className="mb-icon"
          aria-label={`Open in ${ide}`}
          onClick={(e) => {
            e.stopPropagation();
            focusSession(s);
          }}
        >
          <CodeXml size={14} />
        </button>
      </span>
    </div>
  );
}

function UseLine({ label, w, now }: { label: string; w: RateWindow | null; now: number }) {
  return (
    <div className="mb-use">
      <span className="mb-use-label">{label}</span>
      {w ? (
        <>
          <Meter value={w.usedPercent} />
          <span className="mb-use-pct">{Math.round(w.usedPercent)}%</span>
          <span className="mb-use-reset">resets in {duration(w.resetsAt - now)}</span>
        </>
      ) : (
        <span className="muted mb-use-none">no data yet</span>
      )}
    </div>
  );
}

function Usage({ snap }: { snap: Snapshot }) {
  const now = useNow();
  const { usage, account, setup } = snap;
  return (
    <section className="mb-usage">
      <h4 className="mb-label">
        Claude usage {account.plan && <span className="plan-pill">{account.plan}</span>}
        <button type="button" className="mb-link" onClick={() => openUrl("https://claude.ai/settings/usage")}>
          claude.ai <ArrowUpRight size={12} />
        </button>
      </h4>
      {setup.statusLine === "installed" ? (
        <>
          <UseLine label="5-hour" w={usage.fiveHour} now={now} />
          <UseLine label="Week" w={usage.sevenDay} now={now} />
        </>
      ) : (
        <p className="mb-note">Connect Claude Code in the dashboard to see your limits.</p>
      )}
    </section>
  );
}

function Tile(props: { on: boolean; title: string; icon: ReactNode; busy?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`mb-tile ${props.on ? "is-on" : ""}`} aria-pressed={props.on} disabled={props.busy} onClick={props.onClick}>
      <span className="mb-tile-icon">{props.busy ? <Spinner /> : props.icon}</span>
      <b>{props.title}</b>
      <span>{props.on ? "On" : "Off"}</span>
    </button>
  );
}

function Switches({ snap }: { snap: Snapshot }) {
  const busy = useStore((s) => s.busy);
  const cfg = snap.settings;
  const awake = snap.power.sleepDisabled === true;
  return (
    <section className="mb-switches">
      <Tile
        on={cfg.notifications}
        title="Notifications"
        icon={cfg.notifications ? <Bell size={15} /> : <BellOff size={15} />}
        onClick={() => {
          if (!cfg.notifications && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
          void api("/api/settings", { notifications: !cfg.notifications });
        }}
      />
      <Tile
        on={cfg.sounds}
        title="Sounds"
        icon={cfg.sounds ? <Volume2 size={15} /> : <VolumeX size={15} />}
        onClick={() => {
          if (!cfg.sounds) playChime("done");
          void api("/api/settings", { sounds: !cfg.sounds });
        }}
      />
      <Tile
        on={awake}
        title="Keep awake"
        icon={awake ? <Coffee size={15} /> : <Moon size={15} />}
        busy={busy.power}
        onClick={() => void act("power", "/api/power", { on: !awake })}
      />
    </section>
  );
}

/** The panel under the menu bar icon: what needs you, every live session, usage and three quick switches. */
export function MenuBarPanel() {
  const snap = useStore((s) => s.snapshot);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [showInactive, setShowInactive] = useState(false);

  // The window takes the panel's own height, so it grows and shrinks with the list.
  useLayoutEffect(() => {
    const el = rootRef.current;
    const list = listRef.current;
    // A soft fade at the bottom says the list goes on below.
    const fade = () => list?.classList.toggle("has-more", list.scrollTop + list.clientHeight < list.scrollHeight - 2);
    const ro = new ResizeObserver(() => {
      if (el) native?.setPanelHeight(el.getBoundingClientRect().height);
      fade();
    });
    if (el) ro.observe(el);
    if (list) ro.observe(list);
    list?.addEventListener("scroll", fade, { passive: true });
    return () => {
      ro.disconnect();
      list?.removeEventListener("scroll", fade);
    };
  }, [snap === null]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && native?.hidePanel();
    // Each time the panel closes, it resets, so it opens at the top.
    const onVisibility = () => {
      if (!document.hidden) return;
      setShowInactive(false);
      listRef.current?.scrollTo({ top: 0 });
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const maxHeight = Math.max(360, Math.min(860, window.screen.availHeight - 40));
  if (!snap)
    return (
      <div ref={rootRef} className="mb mb-loading">
        <Spinner /> Looking for your Claude Code sessions…
      </div>
    );

  const sessions = snap.sessions;
  const asks = sessions.filter(needsYou).sort((a, b) => a.activity.since - b.activity.since);
  const rest = sessions.filter((s) => !needsYou(s));
  const active = rest.filter((s) => s.activity.kind !== "inactive");
  const inactive = rest.filter((s) => s.activity.kind === "inactive");

  return (
    <div ref={rootRef} className="mb" style={{ maxHeight }}>
      <Head sessions={sessions} />
      <div ref={listRef} className="mb-list">
        {asks.length > 0 && (
          <section>
            <h4 className="mb-label">
              Needs you <span className="count-pill">{asks.length}</span>
            </h4>
            {asks.map((s) => (
              <AskCard key={s.pid} s={s} />
            ))}
          </section>
        )}
        <section>
          {asks.length > 0 && active.length > 0 && <h4 className="mb-label">Sessions</h4>}
          {active.map((s) => (
            <Row key={s.pid} s={s} />
          ))}
          {sessions.length === 0 && (
            <div className="mb-empty">
              <b>No live sessions</b>
              <span>Start Claude Code in a terminal and it shows up here.</span>
            </div>
          )}
          {inactive.length > 0 && (
            <button type="button" className={`mb-more ${showInactive ? "is-open" : ""}`} onClick={() => setShowInactive(!showInactive)}>
              <ChevronDown size={14} />
              {showInactive ? "Hide" : "Show"} {plural(inactive.length, "inactive session")}
            </button>
          )}
          {showInactive && inactive.map((s) => <Row key={s.pid} s={s} />)}
        </section>
      </div>
      <Usage snap={snap} />
      <Switches snap={snap} />
      <footer className="mb-foot">
        <button type="button" className="btn btn-primary" onClick={() => openDashboard(null)}>
          <LayoutDashboard size={15} /> Open dashboard
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => (native ? native.showMenu("walls") : openWallWindow(null))}>
          <Screen size={15} /> Wall on… <ChevronDown size={13} />
        </button>
      </footer>
      <Toasts />
    </div>
  );
}
