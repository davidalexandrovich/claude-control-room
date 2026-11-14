import { ArrowUpRight, Check, CircleCheck, Coffee, FolderGit2, Minus, Moon, RefreshCw, Sparkles, UserRound } from "lucide-react";
import { type CSSProperties, useRef } from "react";
import type { AgentUsage, RateWindow, Session, Snapshot, Usage } from "../../../shared/types.ts";
import { duration, resetLabel } from "../lib/format.ts";
import {
  accountChoices,
  accountFilterOf,
  act,
  matchesAccount,
  isShell,
  needsYou,
  openMenu,
  openSession,
  remember,
  setAccountFilter,
  setState,
  useStore,
  type Filter,
} from "../store.ts";
import { openUrl, PrChip } from "./Monitor.tsx";
import { Meter, StatusOrb, Toggle, useNow } from "./Primitives.tsx";
import { CARD_SIZE, CARDS, cardColumns, type CardId, dragGap } from "../lib/cards.ts";
import { minimizeCard, restoreCard, setCardWidths } from "../lib/overview.ts";
import { dragFrom } from "../lib/resize.ts";

export const GROUPS: { id: Filter; label: string; kinds: string[]; color: string }[] = [
  { id: "working", label: "working", kinds: ["working", "background"], color: "var(--working)" },
  { id: "attention", label: "need you", kinds: ["approval", "question", "waiting"], color: "var(--approval)" },
  { id: "idle", label: "idle", kinds: ["idle"], color: "var(--idle)" },
  { id: "inactive", label: "inactive", kinds: ["inactive"], color: "var(--inactive)" },
];

function SessionsCard({ sessions }: { sessions: Session[] }) {
  const counts = GROUPS.map((g) => sessions.filter((s) => g.kinds.includes(s.activity.kind)).length);
  // A selector must give the same value back each time, so the list is made from the snapshot here.
  const choices = accountChoices(useStore((s) => s.snapshot));
  const account = useStore(accountFilterOf);
  const total = sessions.length;
  const pick = (f: Filter) => {
    setState({ filter: f });
    remember("cr.filter", f);
  };
  return (
    <section className="card card-sessions">
      <h3 className="card-title">Sessions</h3>
      <div className="big-number">
        {total}
        <span className="big-unit">live</span>
      </div>
      <div className="stack-bar" aria-hidden>
        {GROUPS.map((g, i) => (counts[i] ? <span key={g.id} style={{ flexGrow: counts[i], background: g.color }} /> : null))}
      </div>
      <div className="legend">
        {GROUPS.map((g, i) => (
          <button key={g.id} type="button" className="legend-item" onClick={() => pick(g.id)}>
            <span className="legend-dot" style={{ background: g.color }} />
            <b>{counts[i]}</b> {g.label}
          </button>
        ))}
      </div>
      {choices.length > 0 && (
        // Click one to see only its sessions; click it again for all.
        <div className="card-accounts">
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`account-count ${c.id === "default" ? "" : "is-account"} ${account === c.id ? "is-on" : ""}`}
              onClick={() => setAccountFilter(account === c.id ? "" : c.id)}
            >
              <b>{sessions.filter((s) => matchesAccount(s, c.id)).length}</b> {c.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AttentionCard({ sessions }: { sessions: Session[] }) {
  const now = useNow();
  const busy = useStore((s) => s.busy);
  const list = sessions.filter(needsYou).sort((a, b) => a.activity.since - b.activity.since);
  return (
    <section className={`card card-attention ${list.length ? "has-items" : ""}`}>
      <h3 className="card-title">
        Needs you {list.length > 0 && <span className="count-pill">{list.length}</span>}
      </h3>
      {list.length === 0 ? (
        <div className="all-clear">
          <CircleCheck size={22} />
          <div>
            <b>All clear</b>
            <span>No session is waiting for you.</span>
          </div>
        </div>
      ) : (
        <ul className="attn-list">
          {list.slice(0, 3).map((s) => {
            const reachable = s.vscodeLinked || !!s.tmux;
            return (
              <li key={s.pid} className="attn-row" onClick={() => setState({ drawer: s.pid, selected: s.pid })} onContextMenu={(e) => openMenu(e, s.pid)}>
                <StatusOrb kind={s.activity.kind} size={9} />
                <div className="attn-text">
                  <span className="attn-name">{s.name}</span>
                  <span className="attn-what">
                    {s.activity.kind === "idle" ? "Waiting for your reply" : (s.activity.detail ?? s.activity.label)} · {duration(now - s.activity.since)}
                  </span>
                </div>
                {s.activity.kind === "approval" && reachable ? (
                  <div className="attn-buttons" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn btn-approve btn-sm"
                      disabled={busy[`${s.pid}:approve`]}
                      onClick={() => void act(`${s.pid}:approve`, `/api/sessions/${s.pid}/approve`)}
                    >
                      <Check size={13} /> Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy[`${s.pid}:reject`]}
                      onClick={() => void act(`${s.pid}:reject`, `/api/sessions/${s.pid}/reject`)}
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      openSession(s);
                    }}
                  >
                    Open
                  </button>
                )}
              </li>
            );
          })}
          {list.length > 3 && <li className="attn-more">+ {list.length - 3} more</li>}
        </ul>
      )}
    </section>
  );
}

function PullRequestsCard({ sessions }: { sessions: Session[] }) {
  const prs = [...new Map(sessions.filter((s) => s.pr).map((s) => [s.pr!.url, s.pr!])).values()];
  // Each pull request opens in the Chrome profile of a session that works on it.
  const pidOf = new Map(sessions.filter((s) => s.pr).map((s) => [s.pr!.url, s.pid]));
  const open = prs.filter((p) => p.state === "OPEN");
  const failing = open.filter((p) => p.checks === "failing").length;
  const approved = open.filter((p) => p.review === "APPROVED").length;
  const merged = prs.filter((p) => p.state === "MERGED").length;
  const shown = [...open, ...prs.filter((p) => p.state !== "OPEN")].slice(0, 3);
  return (
    <section className="card card-prs">
      <h3 className="card-title">Pull requests</h3>
      <div className="stat-row">
        <div className="stat">
          <b>{open.length}</b>
          <span>open</span>
        </div>
        <div className="stat">
          <b className={approved ? "tone-good" : ""}>{approved}</b>
          <span>approved</span>
        </div>
        <div className="stat">
          <b className={failing ? "tone-bad" : ""}>{failing}</b>
          <span>failing</span>
        </div>
        <div className="stat">
          <b className="tone-merged">{merged}</b>
          <span>merged</span>
        </div>
      </div>
      <ul className="pr-list">
        {shown.map((p) => (
          <li key={p.url} onClick={() => openUrl(p.url, { pid: pidOf.get(p.url) })}>
            <PrChip pr={p} pid={pidOf.get(p.url)} />
            <span className="pr-title">{p.title}</span>
          </li>
        ))}
        {prs.length === 0 && <li className="muted">No pull requests linked to live sessions.</li>}
      </ul>
    </section>
  );
}

function UsageLine({ label, w, now }: { label: string; w: RateWindow | null; now: number }) {
  return (
    <div className="usage-line">
      <span className="usage-label">{label}</span>
      {w ? (
        <>
          <Meter value={w.usedPercent} />
          <span className="usage-pct mono">{Math.round(w.usedPercent)}%</span>
          <span className="usage-reset" data-tip={`Resets ${resetLabel(w.resetsAt, now)}`}>
            resets in {duration(w.resetsAt - now)}
          </span>
        </>
      ) : (
        <span className="muted">no data yet</span>
      )}
    </div>
  );
}

/** One account's limits, under its name, when there is more than one account. */
function AccountUsage(props: { label: string; email: string | null; plan: string | null; usage: Usage; connected: boolean; now: number }) {
  const busy = useStore((s) => s.busy.statusline);
  return (
    <>
      <div className="usage-account">
        <b>{props.label}</b>
        <span className="muted">{props.email ?? "not signed in"}</span>
        {props.plan && <span className="plan-pill">{props.plan}</span>}
      </div>
      {props.connected ? (
        <>
          <UsageLine label="5-hour" w={props.usage.fiveHour} now={props.now} />
          <UsageLine label="Week" w={props.usage.sevenDay} now={props.now} />
        </>
      ) : (
        // Signed in or not, its usage reaches here only through Control Room's status line in its own settings.
        <div className="usage-connect">
          <span className="muted">Usage not reported yet</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            data-tip="Adds Control Room's status line to this account's settings, so its usage shows here. They are backed up first."
            onClick={() => void act("statusline", "/api/setup/statusline", { install: true })}
          >
            Connect
          </button>
        </div>
      )}
    </>
  );
}

/** Where to see an agent's usage when it does not report it here: Codex before its first reply, and the others always. */
const USAGE_ELSEWHERE: Record<string, { text: string; tip: string; url?: string }> = {
  codex: { text: "after its first reply", tip: "Codex reports its limits with each reply. Open your usage page on chatgpt.com", url: "https://chatgpt.com/codex/settings/usage" },
  gemini: { text: "/stats in its console", tip: "Gemini keeps its quota on Google's side: type /stats in a Gemini console to see it" },
  cursor: { text: "cursor.com", tip: "Cursor keeps your usage on its site. Open your dashboard on cursor.com", url: "https://cursor.com/dashboard" },
  kimi: { text: "/usage in its console", tip: "Kimi Code keeps its quota on its side: type /usage in a Kimi console to see it" },
  ollama: { text: "local, no limits", tip: "Models on this Mac have no limits. Cloud models' usage is on ollama.com", url: "https://ollama.com/settings" },
};

/** The built-in agents you have, with their limits when they report them. */
function agentRows(snap: Snapshot): { id: string; label: string; usage: AgentUsage | null }[] {
  return snap.setup.agents
    .map((a) => ({ id: a.id, label: a.label, installed: a.installed, usage: snap.agentUsage.find((u) => u.id === a.id) ?? null }))
    .filter((a) => USAGE_ELSEWHERE[a.id] && (a.installed || a.usage));
}

/** The agents that report their limits get lines like Claude's; the others share one line that says where to look. */
function AgentUsageRows({ snap, now }: { snap: Snapshot; now: number }) {
  const rows = agentRows(snap);
  if (!rows.length) return null;
  const elsewhere = rows.filter((r) => !r.usage);
  return (
    <div className="usage-agents">
      {rows.map(({ id, label, usage }) =>
        usage ? (
          <div key={id}>
            <div className="usage-account">
              <b>{label}</b>
              {usage.plan && <span className="plan-pill">{usage.plan}</span>}
              {USAGE_ELSEWHERE[id].url && (
                <button type="button" className="icon-btn usage-agent-link" aria-label={`Open ${label} usage`} data-tip={`Open your ${label} usage page`} onClick={() => openUrl(USAGE_ELSEWHERE[id].url!)}>
                  <ArrowUpRight size={14} />
                </button>
              )}
            </div>
            {usage.windows.length ? usage.windows.map((w) => <UsageLine key={w.minutes} label={w.label} w={w} now={now} />) : <UsageLine label="Limits" w={null} now={now} />}
          </div>
        ) : null,
      )}
      {elsewhere.length > 0 && (
        <div className="usage-elsewhere">
          {elsewhere.map(({ id, label }) => {
            const where = USAGE_ELSEWHERE[id];
            return (
              <span key={id} data-tip={where.tip}>
                <b>{label}</b>{" "}
                {where.url ? (
                  <button type="button" className="mb-link" onClick={() => openUrl(where.url!)}>
                    {where.text} <ArrowUpRight size={11} />
                  </button>
                ) : (
                  <span className="mono">{where.text}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UsageCard({ snap }: { snap: Snapshot }) {
  const now = useNow();
  const busy = useStore((s) => s.busy);
  const { usage, account, setup, otherAccounts } = snap;
  // Beside other agents, Claude's limits get a name of their own.
  const agents = agentRows(snap).length > 0;
  const claude = (label: string) => (agents ? `Claude · ${label}` : label);
  return (
    <section className="card card-usage">
      <h3 className="card-title">
        {agents ? "Usage" : "Claude usage"} {!otherAccounts.length && !agents && account.plan && <span className="plan-pill">{account.plan}</span>}
      </h3>
      {setup.statusLine === "installed" && otherAccounts.length > 0 ? (
        <>
          <AccountUsage label={claude(snap.settings.defaultAccountLabel)} email={account.email} plan={account.plan} usage={usage} connected now={now} />
          {otherAccounts.map((a) => (
            <AccountUsage key={a.dir} label={claude(a.label)} email={a.loggedIn ? a.email : null} plan={a.plan} usage={a.usage} connected={a.connected} now={now} />
          ))}
        </>
      ) : setup.statusLine === "installed" ? (
        <>
          {agents && (
            <div className="usage-account">
              <b>Claude</b>
              {account.plan && <span className="plan-pill">{account.plan}</span>}
            </div>
          )}
          <UsageLine label="5-hour" w={usage.fiveHour} now={now} />
          <UsageLine label="Week" w={usage.sevenDay} now={now} />
        </>
      ) : (
        <div className="connect-hint">
          <Sparkles size={16} />
          <span>Connect Claude Code to see your 5-hour and weekly limits.</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy.statusline} onClick={() => void act("statusline", "/api/setup/statusline", { install: true })}>
            Connect
          </button>
        </div>
      )}
      <div className="account-row">
        <UserRound size={14} />
        <span className="account-email" data-tip={account.orgName ?? ""}>
          {account.email ?? "Not signed in"}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy.switch}
          data-tip="Sign in to Claude Code with another account, in a private browser window"
          onClick={() => void act("switch", "/api/account/switch")}
        >
          <RefreshCw size={13} /> Switch account
        </button>
        <button type="button" className="icon-btn" aria-label="Open claude.ai usage" data-tip="Open your usage page on claude.ai" onClick={() => openUrl("https://claude.ai/settings/usage", { account: "" })}>
          <ArrowUpRight size={15} />
        </button>
      </div>
      <AgentUsageRows snap={snap} now={now} />
    </section>
  );
}

function MacCard({ snap }: { snap: Snapshot }) {
  const busy = useStore((s) => s.busy);
  const awake = snap.power.sleepDisabled;
  const worktreeRepos = new Set(snap.sessions.filter((s) => s.git?.isWorktree).map((s) => s.git!.mainRoot)).size;
  return (
    <section className="card card-mac">
      <h3 className="card-title">This Mac</h3>
      <div className="mac-row">
        <span className={`mac-icon ${awake ? "is-awake" : ""}`}>{awake ? <Coffee size={18} /> : <Moon size={18} />}</span>
        <div className="mac-text">
          <b>{awake === null ? "Sleep setting unknown" : awake ? "Always awake" : "Sleeps normally"}</b>
          <span>{awake ? "Even with the lid closed" : "Sleeps when idle or closed"}</span>
        </div>
        <Toggle
          on={awake === true}
          busy={busy.power}
          label="Keep this Mac awake"
          onChange={(on) => void act("power", "/api/power", { on })}
        />
      </div>
      <div className="mac-row">
        <span className="mac-icon">
          <FolderGit2 size={18} />
        </span>
        <div className="mac-text">
          <b>Worktrees</b>
          <span>{worktreeRepos ? "Find folders safe to delete" : "Clean up finished work"}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setState({ panel: "worktrees" })}>
          Clean up
        </button>
      </div>
    </section>
  );
}

const CARD_NAMES: Record<CardId, string> = { sessions: "Sessions", attention: "Needs you", prs: "Pull requests", usage: "Usage", mac: "This Mac" };

/** What a folded card still tells: a short value on its chip, the rest in its tip. Needs you stays loud while it counts. */
function chipOf(id: CardId, snap: Snapshot, sessions: Session[]): { value: string; tip: string; alert?: boolean } {
  switch (id) {
    case "sessions": {
      const counts = GROUPS.map((g) => sessions.filter((s) => g.kinds.includes(s.activity.kind)).length);
      return { value: `${sessions.length} · ${counts[0]} working`, tip: GROUPS.map((g, i) => `${counts[i]} ${g.label}`).join(", ") };
    }
    case "attention": {
      const list = sessions.filter(needsYou);
      return { value: String(list.length), alert: list.length > 0, tip: list.length ? list.map((s) => s.name).join(", ") : "No session is waiting for you." };
    }
    case "prs": {
      const prs = [...new Map(sessions.filter((s) => s.pr).map((s) => [s.pr!.url, s.pr!])).values()];
      const open = prs.filter((p) => p.state === "OPEN");
      const failing = open.filter((p) => p.checks === "failing").length;
      return { value: `${open.length} open`, tip: `${open.length} open, ${failing} failing, ${prs.filter((p) => p.state === "MERGED").length} merged` };
    }
    case "usage": {
      const pct = (w: RateWindow | null) => (w ? `${Math.round(w.usedPercent)}%` : "—");
      const all = [{ label: snap.settings.defaultAccountLabel, usage: snap.usage }, ...snap.otherAccounts.map((a) => ({ label: a.label, usage: a.usage }))];
      // Other agents' tightest limit: the window they are closest to running out of.
      const agents = snap.agentUsage
        .filter((u) => u.windows.length)
        .map((u) => ({ label: u.label, top: Math.max(...u.windows.map((w) => w.usedPercent)), tip: u.windows.map((w) => `${w.label.toLowerCase()} ${pct(w)}`).join(", ") }));
      return {
        value: [
          all.length === 1 ? `${pct(snap.usage.fiveHour)} · week ${pct(snap.usage.sevenDay)}` : all.map((a) => `${a.label} ${pct(a.usage.fiveHour)}`).join(" · "),
          ...agents.map((a) => `${a.label} ${Math.round(a.top)}%`),
        ].join(" · "),
        tip: [...all.map((a) => `${a.label}: 5-hour ${pct(a.usage.fiveHour)}, week ${pct(a.usage.sevenDay)}`), ...agents.map((a) => `${a.label}: ${a.tip}`)].join(" · "),
      };
    }
    case "mac":
      return { value: snap.power.sleepDisabled ? "Awake" : "Sleeps", tip: snap.power.sleepDisabled ? "Always awake is on" : "Always awake is off" };
  }
}

/** The folded cards, as chips: beside the open ones, or in one slim row once every card is folded. A click opens one. */
export function CardChips({ snap, ids, below = false }: { snap: Snapshot; ids: readonly CardId[]; below?: boolean }) {
  const sessions = snap.sessions.filter((s) => !isShell(s));
  return (
    <>
      {ids.map((id) => {
        const c = chipOf(id, snap, sessions);
        return (
          <button
            key={id}
            type="button"
            className={`ov-chip ${c.alert ? "is-alert" : ""}`}
            data-tip={`${c.tip}. Click to show the card.`}
            data-tip-side={below ? "bottom" : undefined}
            onClick={() => restoreCard(id)}
          >
            <span className="ov-chip-name">{CARD_NAMES[id]}</span>
            <b>{c.value}</b>
          </button>
        );
      })}
    </>
  );
}

export function Overview({ snap }: { snap: Snapshot }) {
  const hidden = useStore((s) => s.ovHidden);
  const widths = useStore((s) => s.ovWidths);
  const grid = useRef<HTMLDivElement>(null);
  // Counts of Claude Code sessions: a terminal is not one.
  const sessions = snap.sessions.filter((s) => !isShell(s));
  const visible = CARDS.filter((id) => !hidden.includes(id));
  const folded = CARDS.filter((id) => hidden.includes(id));
  if (!visible.length) {
    return (
      <div className="ov-dock" aria-label="Minimized cards">
        <CardChips snap={snap} ids={CARDS} below />
      </div>
    );
  }

  const card = (id: CardId) => {
    switch (id) {
      case "sessions":
        return <SessionsCard sessions={sessions} />;
      case "attention":
        return <AttentionCard sessions={sessions} />;
      case "prs":
        return <PullRequestsCard sessions={sessions} />;
      case "usage":
        return <UsageCard snap={snap} />;
      case "mac":
        return <MacCard snap={snap} />;
    }
  };
  // The gap after card i moves the edge between it and the next: those two trade width, the rest keep theirs.
  const startDrag = (e: React.PointerEvent, i: number) => {
    const slots = [...(grid.current?.querySelectorAll<HTMLElement>(":scope > .ov-slot") ?? [])];
    const measured: Record<string, number> = Object.fromEntries(visible.map((id, k) => [id, slots[k]?.getBoundingClientRect().width ?? 0]));
    const [l, r] = [visible[i], visible[i + 1]];
    dragFrom(e, "col-resize", (dx) => {
      const [wl, wr] = dragGap({ w: measured[l], min: CARD_SIZE[l].min }, { w: measured[r], min: CARD_SIZE[r].min }, dx);
      setCardWidths({ ...widths, ...measured, [l]: wl, [r]: wr });
    });
  };
  return (
    <div ref={grid} className="overview" style={{ "--ov-cols": cardColumns(visible, widths, folded.length > 0) } as CSSProperties}>
      {visible.map((id, i) => (
        <div key={id} className={`ov-slot ov-slot-${id}`}>
          {card(id)}
          <button type="button" className="ov-min" aria-label={`Minimize ${CARD_NAMES[id]}`} data-tip="Minimize to a chip" onClick={() => minimizeCard(id)}>
            <Minus size={13} />
          </button>
          {i < visible.length - 1 && (
            <div className="ov-gap" role="separator" aria-orientation="vertical" data-tip="Drag to resize · double-click for the usual widths" onPointerDown={(e) => startDrag(e, i)} onDoubleClick={() => setCardWidths(null)} />
          )}
        </div>
      ))}
      {folded.length > 0 && (
        <div className="ov-tray" aria-label="Minimized cards">
          <CardChips snap={snap} ids={folded} />
        </div>
      )}
    </div>
  );
}
