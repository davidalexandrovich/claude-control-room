import { CodeXml, FolderOpen, GitPullRequest, PictureInPicture2, SquareKanban, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatLine, Session } from "../../../shared/types.ts";
import { duration, folderName, money, startedLabel } from "../lib/format.ts";
import { popoutSession } from "../lib/native.ts";
import { act, api, setState } from "../store.ts";
import { ApprovalCard, openUrl, PrChip, QuestionCard, RemoteButton } from "./Monitor.tsx";
import { StatusOrb, useNow } from "./Primitives.tsx";

function useChat(pid: number): ChatLine[] {
  const [chat, setChat] = useState<ChatLine[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api<{ chat: ChatLine[] }>(`/api/sessions/${pid}/chat`).then((r) => {
        if (alive) setChat(r.chat ?? []);
      });
    load();
    const t = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pid]);
  return chat;
}

function Conversation({ pid }: { pid: number }) {
  const chat = useChat(pid);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = chat.length ? chat[chat.length - 1].text : "";
  // Stay at the newest line unless the person scrolled up to read.
  useEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [chat.length, last]);
  if (!chat.length) return <p className="muted">No conversation yet.</p>;
  return (
    <div
      className="convo"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {chat.map((c, i) =>
        c.role === "tool" ? (
          <div key={i} className="convo-tool">
            <span className="convo-dot" /> {c.text}
          </div>
        ) : (
          <div key={i} className={`convo-msg convo-${c.role}`}>
            <div className="convo-who">{c.role === "user" ? "You" : "Claude"}</div>
            <div className="convo-text">{c.text.length > 1800 ? `${c.text.slice(0, 1800)}…` : c.text}</div>
          </div>
        ),
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function SessionDetail({ s, variant }: { s: Session; variant: "drawer" | "focus" | "popout" }) {
  const now = useNow();
  const a = s.activity;
  const g = s.git;
  const [showClaims, setShowClaims] = useState(false);
  const where = s.tmux ? `tmux ${s.tmux.split(":")[0]}` : s.where === "vscode" ? (s.vscodeLinked ? "VS Code terminal (linked)" : "VS Code terminal") : "Terminal";
  return (
    <div className={`detail detail-${variant} st-${a.kind}`}>
      <div className="detail-head">
        <div className="detail-status">
          <StatusOrb kind={a.kind} size={12} />
          <span className="detail-status-label">{a.label}</span>
          <span className="detail-status-time">· {duration(now - a.since)}</span>
          {variant === "drawer" && (
            <button type="button" className="icon-btn detail-close" aria-label="Close details" onClick={() => setState({ drawer: null })}>
              <X size={16} />
            </button>
          )}
        </div>
        <h2 className="detail-title">{s.name}</h2>
        {s.nameSource !== "summary" && <p className="detail-headline">{s.summary.headline}</p>}
        {s.summary.now && <p className="detail-now">{s.summary.now}</p>}
        {a.detail && a.kind === "working" && <p className="detail-doing">{a.detail}</p>}
      </div>

      {a.kind === "approval" && <ApprovalCard s={s} />}
      {a.kind === "question" && <QuestionCard s={s} />}

      <div className="detail-actions">
        <button type="button" className="btn btn-primary" onClick={() => void act(`${s.pid}:focus`, `/api/sessions/${s.pid}/focus`, {}, true)}>
          <CodeXml size={15} /> Open in VS Code
        </button>
        <RemoteButton s={s} look="button" />
        {s.pr && (
          <button type="button" className="btn btn-ghost" onClick={() => openUrl(s.pr!.url)}>
            <GitPullRequest size={15} /> PR #{s.pr.number}
          </button>
        )}
        {s.story && (
          <button type="button" className="btn btn-ghost" onClick={() => openUrl(s.story!.url)}>
            <SquareKanban size={15} /> Story
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon" data-tip="Show the folder in Finder" aria-label="Folder" onClick={() => void api("/api/open", { folder: g?.root ?? s.cwd })}>
          <FolderOpen size={15} />
        </button>
        {variant !== "popout" && (
          <button type="button" className="btn btn-ghost btn-icon" data-tip="Pop out to its own window" aria-label="Pop out" onClick={() => popoutSession(s.pid)}>
            <PictureInPicture2 size={15} />
          </button>
        )}
        <button type="button" className="btn btn-danger-ghost detail-close-btn" onClick={() => setState({ closing: s.pid })}>
          <X size={15} /> Close…
        </button>
      </div>

      <div className="detail-body">
        <dl className="dl">
          <Row label="Repository">
            {s.repoName}
            {g?.isWorktree && <span className="muted"> · worktree {folderName(g.root)}</span>}
          </Row>
          {g?.branch && (
            <Row label="Branch">
              <span className="mono">{g.branch}</span>
              {g.ahead > 0 && <span className="muted"> · {g.ahead} commit{g.ahead === 1 ? "" : "s"} ahead</span>}
            </Row>
          )}
          {g && (g.dirty > 0 || g.insertions > 0 || g.deletions > 0) && (
            <Row label="Changes">
              {g.dirty} file{g.dirty === 1 ? "" : "s"} not committed
              {g.insertions > 0 && <span className="mono tone-good"> +{g.insertions}</span>}
              {g.deletions > 0 && <span className="mono tone-bad"> −{g.deletions}</span>}
            </Row>
          )}
          {s.pr && (
            <Row label="Pull request">
              <PrChip pr={s.pr} /> <span className="muted">{s.pr.title}</span>
            </Row>
          )}
          {s.storyId && (
            <Row label="Story">
              <span className="mono">sc-{s.storyId}</span> {s.story ? <span>{s.story.name}</span> : <span className="muted">(add a Shortcut token in Settings)</span>}
              {s.story?.state && <span className="chip-state"> {s.story.state}</span>}
            </Row>
          )}
          {s.claims.length > 0 && (
            <Row label="Claims">
              <button type="button" className="link" onClick={() => setShowClaims((v) => !v)}>
                {s.claims.reduce((n, c) => n + c.paths.length, 0)} paths
                {s.claims.some((c) => c.leases.length) ? ` · leases: ${s.claims.flatMap((c) => c.leases).join(", ")}` : ""}
              </button>
              {showClaims && (
                <ul className="claim-list">
                  {s.claims.flatMap((c) => c.paths).map((p) => (
                    <li key={p} className="mono">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </Row>
          )}
          <Row label="Model">
            {s.model ?? "—"} · effort {s.effort ?? "—"}
            {s.effortIsDefault && <span className="muted"> (default)</span>}
            {s.contextPercent !== null && <span className="muted"> · context {Math.round(s.contextPercent)}%</span>}
            {money(s.costUsd) && <span className="muted"> · {money(s.costUsd)}</span>}
          </Row>
          <Row label="Started">
            {startedLabel(s.startedAt, now)} <span className="muted">· {duration(now - s.startedAt)} ago</span>
          </Row>
          <Row label="Runs in">
            {where} <span className="muted mono">· pid {s.pid}</span>
          </Row>
        </dl>

        <h4 className="detail-section">Conversation</h4>
        <Conversation pid={s.pid} />
      </div>
    </div>
  );
}
