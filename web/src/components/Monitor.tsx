import {
  Check,
  CircleCheck,
  CircleX,
  CodeXml,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
  Pencil,
  PictureInPicture2,
  Smartphone,
  SquareKanban,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { type MouseEvent, useRef, useState } from "react";
import type { PullRequest, Session } from "../../../shared/types.ts";
import { duration } from "../lib/format.ts";
import { popoutSession } from "../lib/native.ts";
import { act, api, setState, useOpenName, useStore } from "../store.ts";
import { IconButton, Ring, StatusOrb, useNow } from "./Primitives.tsx";

export function openUrl(url: string): void {
  void api("/api/open", { url });
}

export function PrChip({ pr }: { pr: PullRequest }) {
  const Icon = pr.state === "MERGED" ? GitMerge : pr.state === "CLOSED" ? GitPullRequestClosed : pr.isDraft ? GitPullRequestDraft : GitPullRequest;
  const state = pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open";
  const checks =
    pr.checks === "failing" ? (
      <CircleX size={12} className="tone-bad" />
    ) : pr.checks === "pending" ? (
      <LoaderCircle size={12} className="tone-wait spin-slow" />
    ) : pr.checks === "passing" ? (
      <CircleCheck size={12} className="tone-good" />
    ) : null;
  const review = pr.review === "APPROVED" ? "Approved" : pr.review === "CHANGES_REQUESTED" ? "Changes requested" : null;
  return (
    <button
      type="button"
      className={`chip chip-pr pr-${state}`}
      data-tip={`${pr.title}${review ? ` · ${review}` : ""}${pr.checks !== "none" ? ` · checks ${pr.checks}` : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        openUrl(pr.url);
      }}
    >
      <Icon size={13} />
      <span>#{pr.number}</span>
      {checks}
      {pr.review === "APPROVED" && <Check size={12} className="tone-good" />}
    </button>
  );
}

function StoryChip({ s }: { s: Session }) {
  if (!s.storyId) return null;
  const label = s.story ? s.story.name : null;
  return (
    <button
      type="button"
      className="chip chip-story"
      data-tip={s.story ? `${s.story.name}${s.story.state ? ` · ${s.story.state}` : ""}` : "Add a Shortcut token in Settings to see this story"}
      onClick={(e) => {
        e.stopPropagation();
        if (s.story) openUrl(s.story.url);
        else setState({ panel: "settings" });
      }}
    >
      <SquareKanban size={13} />
      <span className="mono">sc-{s.storyId}</span>
      {label && <span className="chip-text">{label}</span>}
    </button>
  );
}

function GitChips({ s }: { s: Session }) {
  const g = s.git;
  if (!g) return null;
  const changed = g.dirty > 0 || g.insertions > 0 || g.deletions > 0;
  return (
    <>
      {!s.pr && g.branch && (
        <span className="chip" data-tip={g.isWorktree ? `Worktree ${g.root}` : g.root}>
          <GitBranch size={13} />
          <span className="chip-text mono">{g.branch}</span>
        </span>
      )}
      {changed && (
        <span className="chip" data-tip={`${g.dirty} changed file${g.dirty === 1 ? "" : "s"} not committed yet`}>
          <span className="mono">{g.dirty} files</span>
          {g.insertions > 0 && <span className="mono tone-good">+{g.insertions}</span>}
          {g.deletions > 0 && <span className="mono tone-bad">−{g.deletions}</span>}
        </span>
      )}
    </>
  );
}

export function lastWords(s: Session): { who: string; text: string } | null {
  const line = [...s.chat].reverse().find((c) => c.role !== "tool");
  if (!line) return null;
  const text = line.text
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { who: line.role === "user" ? "You" : "Claude", text };
}

export function ApprovalCard({ s }: { s: Session }) {
  const busy = useStore((st) => st.busy);
  const openIn = useOpenName(s);
  const reachable = s.vscodeLinked || !!s.tmux;
  const t = s.activity.tool;
  return (
    <div className="ask-card" onClick={(e) => e.stopPropagation()}>
      <div className="ask-what">{t?.action ?? "A tool wants to run"}</div>
      {t?.detail && <div className="ask-detail mono">{t.detail}</div>}
      <div className="ask-buttons">
        <button
          type="button"
          className="btn btn-approve"
          disabled={!reachable || busy[`${s.pid}:approve`]}
          onClick={() => void act(`${s.pid}:approve`, `/api/sessions/${s.pid}/approve`)}
        >
          <Check size={15} /> Approve
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!reachable || busy[`${s.pid}:reject`]}
          onClick={() => void act(`${s.pid}:reject`, `/api/sessions/${s.pid}/reject`)}
        >
          Reject
        </button>
        {!reachable && (
          <button type="button" className="btn btn-link" onClick={() => void act(`${s.pid}:focus`, `/api/sessions/${s.pid}/focus`)}>
            Open in {openIn}
          </button>
        )}
      </div>
      {!reachable && (
        <div className="ask-hint">
          {s.ide === "vscode" ? "Install the VS Code helper (Settings) to answer from here." : "Control Room can type only into tmux and VS Code terminals."}
        </div>
      )}
    </div>
  );
}

export function QuestionCard({ s }: { s: Session }) {
  const busy = useStore((st) => st.busy);
  const openIn = useOpenName(s);
  const q = s.activity.question;
  const reachable = s.vscodeLinked || !!s.tmux;
  const answerable = reachable && q && q.count === 1 && !q.multiSelect && q.options.length > 0;
  return (
    <div className="ask-card" onClick={(e) => e.stopPropagation()}>
      {q?.question && <div className="ask-what">{q.question}</div>}
      {answerable ? (
        <div className="ask-options">
          {q.options.slice(0, 4).map((o, i) => (
            <button
              key={o.label}
              type="button"
              className="btn btn-option"
              data-tip={o.description ?? undefined}
              disabled={busy[`${s.pid}:answer`]}
              onClick={() => void act(`${s.pid}:answer`, `/api/sessions/${s.pid}/answer`, { option: i })}
            >
              <span className="opt-num">{i + 1}</span>
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="ask-buttons">
          <button type="button" className="btn btn-approve" onClick={() => void act(`${s.pid}:focus`, `/api/sessions/${s.pid}/focus`)}>
            Answer in {openIn}
          </button>
        </div>
      )}
    </div>
  );
}

/** Sends the session to the Claude app with /remote-control; once it is there, opens it at claude.ai. */
export function RemoteButton({ s, look = "pill" }: { s: Session; look?: "pill" | "button" | "icon" }) {
  const sending = useStore((st) => st.busy[`${s.pid}:remote`]);
  const on = s.remoteUrl !== null;
  const asking = !on && (s.activity.kind === "approval" || s.activity.kind === "question");
  const tip = on
    ? "On your phone: it is in the Claude app under Code. Click to open it at claude.ai"
    : asking
      ? "Answer the session first, then send it to your phone"
      : "Remote control: continue this session on your phone";
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    if (s.remoteUrl) openUrl(s.remoteUrl);
    else void act(`${s.pid}:remote`, `/api/sessions/${s.pid}/remote`);
  };
  const size = look === "pill" ? 13 : look === "icon" ? 14 : 15;
  const icon = sending ? <LoaderCircle size={size} className="spin-fast" /> : <Smartphone size={size} />;
  const props = { type: "button" as const, "data-tip": tip, "aria-label": on ? "Open on claude.ai" : "Remote control", disabled: sending || asking, onClick: click };
  if (look === "icon") {
    return (
      <button {...props} className={`mb-icon ${on ? "is-shown is-on" : ""}`}>
        {icon}
      </button>
    );
  }
  if (look === "button") {
    return (
      <button {...props} className={`btn btn-ghost ${on ? "btn-rc-on" : ""}`}>
        {icon} {on ? "On your phone" : "Remote control"}
      </button>
    );
  }
  return (
    <button {...props} className={`rc-btn ${on ? "is-on" : ""}`} data-tip-side="bottom">
      {icon}
      <span>rc</span>
    </button>
  );
}

/** Starts a rename. It renames the session's VS Code tab too, so it needs the VS Code helper. */
export function RenameButton({ s, onClick }: { s: Session; onClick: () => void }) {
  return (
    <IconButton label={s.vscodeLinked ? "Rename (its VS Code tab too)" : "Rename works for sessions in VS Code terminals"} disabled={!s.vscodeLinked} onClick={onClick}>
      <Pencil size={14} />
    </IconButton>
  );
}

/** A box for the session's new name: Enter saves it, on the VS Code tab too; Esc cancels. */
export function NameEditor({ s, className, onDone }: { s: Session; className: string; onDone: () => void }) {
  const [value, setValue] = useState(s.name);
  const box = useRef<HTMLInputElement>(null);
  const saving = useStore((st) => !!st.busy[`${s.pid}:rename`]);
  const save = async () => {
    const name = value.trim();
    if (!name || name === s.name) return onDone();
    if ((await act(`${s.pid}:rename`, `/api/sessions/${s.pid}/rename`, { name }, true)).ok) onDone();
    else box.current?.focus();
  };
  return (
    <input
      ref={box}
      className={`name-input ${className}`}
      value={value}
      maxLength={120}
      readOnly={saving}
      autoFocus
      aria-label="New name"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") void save();
        else if (e.key === "Escape") onDone();
      }}
      onBlur={() => {
        if (!saving) onDone();
      }}
    />
  );
}

/** The plain-English task under the title; when the title already is the headline, the latest state. */
export function taskLine(s: Session): string {
  return s.nameSource === "summary" ? (s.summary.now ?? "") : s.summary.headline;
}

export function statusTime(s: Session, now: number): string {
  return duration(now - s.activity.since);
}

export function Monitor({ s, index, selected }: { s: Session; index: number; selected: boolean }) {
  const now = useNow();
  const a = s.activity;
  // The plain-English "now" line tells an idle session's state best, unless the task line already shows it.
  const settled = a.kind === "idle" || a.kind === "inactive" || a.kind === "background";
  const detail = settled ? ((s.nameSource !== "summary" ? s.summary.now : null) ?? a.detail) : a.detail;
  const words = lastWords(s);
  const asking = a.kind === "approval" || a.kind === "question";
  const [renaming, setRenaming] = useState(false);
  const openIn = useOpenName(s);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.8 }}
      className={`monitor st-${a.kind} ${selected ? "is-selected" : ""} ${a.askedYou ? "asked-you" : ""}`}
      onClick={() => setState({ drawer: s.pid, selected: s.pid })}
      data-pid={s.pid}
    >
      <div className="mon-screen" aria-hidden />
      <header className="mon-head">
        <span className="mon-key" data-tip={index < 9 ? `Press ${index + 1} to select` : undefined}>{index + 1}</span>
        {renaming ? <NameEditor s={s} className="mon-title" onDone={() => setRenaming(false)} /> : <h3 className="mon-title">{s.name}</h3>}
        <div className="mon-actions">
          <RenameButton s={s} onClick={() => setRenaming(true)} />
          <IconButton label={`Open in ${openIn}`} onClick={() => void act(`${s.pid}:focus`, `/api/sessions/${s.pid}/focus`, {}, true)}>
            <CodeXml size={15} />
          </IconButton>
          <IconButton label="Pop out to its own window" onClick={() => popoutSession(s.pid)}>
            <PictureInPicture2 size={15} />
          </IconButton>
        </div>
        <RemoteButton s={s} />
        <IconButton label="Close session…" tone="danger" onClick={() => setState({ closing: s.pid })}>
          <X size={15} />
        </IconButton>
      </header>

      <p className="mon-task">{taskLine(s)}</p>

      <div className="mon-chips">
        {s.pr && <PrChip pr={s.pr} />}
        <StoryChip s={s} />
        <GitChips s={s} />
      </div>

      <section className="mon-status">
        <div className="mon-status-line">
          <StatusOrb kind={a.kind} size={12} />
          <span className="mon-status-label">{a.label}</span>
          <span className="mon-status-time">· {statusTime(s, now)}</span>
        </div>
        {!asking && detail && <div className="mon-status-detail">{detail}</div>}
        {a.kind === "approval" && <ApprovalCard s={s} />}
        {a.kind === "question" && <QuestionCard s={s} />}
      </section>

      {!asking && words && (
        <blockquote className="mon-preview">
          <span className="who">{words.who}</span> {words.text}
        </blockquote>
      )}

      <footer className="mon-foot">
        <span className="foot-item" data-tip="Model">
          {s.model ?? "—"}
        </span>
        <span className="foot-dot">·</span>
        <span className="foot-item" data-tip={s.effortIsDefault ? "Effort (your default)" : "Effort"}>
          {s.effort ?? "—"}
        </span>
        <span className="foot-dot">·</span>
        <span className="foot-item foot-repo" data-tip={s.git?.isWorktree ? `Worktree ${s.git.root}` : s.cwd}>
          {s.repoName}
        </span>
        {s.contextPercent !== null && (
          <span className="foot-ctx" data-tip={`Context window ${Math.round(s.contextPercent)}% full`}>
            <Ring value={s.contextPercent} />
            <span className="mono">{Math.round(s.contextPercent)}%</span>
          </span>
        )}
      </footer>
    </motion.article>
  );
}
