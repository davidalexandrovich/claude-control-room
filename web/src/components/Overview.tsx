import { ArrowUpRight, Check, CircleCheck, Coffee, FolderGit2, Moon, RefreshCw, Sparkles, UserRound } from "lucide-react";
import type { RateWindow, Session, Snapshot, Usage } from "../../../shared/types.ts";
import { duration, plural, resetLabel } from "../lib/format.ts";
import {
  accountChoices,
  accountFilterOf,
  act,
  matchesAccount,
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

function UsageCard({ snap }: { snap: Snapshot }) {
  const now = useNow();
  const busy = useStore((s) => s.busy);
  const { usage, account, setup, otherAccounts } = snap;
  return (
    <section className="card card-usage">
      <h3 className="card-title">
        Claude usage {!otherAccounts.length && account.plan && <span className="plan-pill">{account.plan}</span>}
      </h3>
      {setup.statusLine === "installed" && otherAccounts.length > 0 ? (
        <>
          <AccountUsage label={snap.settings.defaultAccountLabel} email={account.email} plan={account.plan} usage={usage} connected now={now} />
          {otherAccounts.map((a) => (
            <AccountUsage key={a.dir} label={a.label} email={a.loggedIn ? a.email : null} plan={a.plan} usage={a.usage} connected={a.connected} now={now} />
          ))}
        </>
      ) : setup.statusLine === "installed" ? (
        <>
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

export function Overview({ snap }: { snap: Snapshot }) {
  const collapsed = useStore((s) => s.overviewCollapsed);
  // Counts of Claude Code sessions: a terminal is not one.
  const sessions = snap.sessions.filter((s) => !s.terminal);
  if (collapsed) {
    const n = sessions.filter(needsYou).length;
    const working = sessions.filter((s) => s.activity.kind === "working").length;
    return (
      <div className="overview-strip">
        <span>{plural(sessions.length, "session")}</span>
        <span className="strip-dot" style={{ background: "var(--working)" }} /> {working} working
        <span className="strip-dot" style={{ background: "var(--approval)" }} /> {n} need you
        {snap.usage.fiveHour && <span className="muted">· 5-hour {Math.round(snap.usage.fiveHour.usedPercent)}%</span>}
        {snap.usage.sevenDay && <span className="muted">· week {Math.round(snap.usage.sevenDay.usedPercent)}%</span>}
        {snap.otherAccounts.map(
          (a) =>
            a.usage.fiveHour && (
              <span key={a.dir} className="muted">
                · {a.label} 5-hour {Math.round(a.usage.fiveHour.usedPercent)}%
              </span>
            ),
        )}
      </div>
    );
  }
  return (
    <div className="overview">
      <SessionsCard sessions={sessions} />
      <AttentionCard sessions={sessions} />
      <PullRequestsCard sessions={sessions} />
      <UsageCard snap={snap} />
      <MacCard snap={snap} />
    </div>
  );
}
