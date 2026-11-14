import { AppWindow, ArrowDownToLine, CodeXml, FolderOpen, GitPullRequest, PictureInPicture2, SquareKanban, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ideName } from "../../../shared/ides.ts";
import type { ChatLine, Session } from "../../../shared/types.ts";
import { duration, folderName, money, startedLabel } from "../lib/format.ts";
import { withKey } from "../lib/keys.ts";
import { popoutSession } from "../lib/native.ts";
import { act, api, closeName, consoleName, getState, openInIde, setState, useIdeName, useOpenName, useStore } from "../store.ts";
import { AccountChip, ApprovalCard, NameEditor, openUrl, PrChip, QuestionCard, RemoteButton, RenameButton } from "./Monitor.tsx";
import { StatusOrb, useNow } from "./Primitives.tsx";
import { TuneChips } from "./Tuning.tsx";
import { dragFrom, keepSizes, setConsoleHeight, setDrawerWidth } from "../lib/resize.ts";

// xterm.js is big; only a window that shows a console loads it.
const Console = lazy(() => import("./Console.tsx"));

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

/** For a session in another terminal: continue the same conversation in Control Room, where its console works. */
function MoveHere({ s }: { s: Session }) {
  const [asking, setAsking] = useState(false);
  const busy = useStore((st) => !!st.busy[`${s.pid}:move`]);
  const tmuxReady = useStore((st) => st.snapshot?.setup.tmuxReady ?? false);
  const idle = s.activity.kind === "idle" || s.activity.kind === "inactive";
  const where = s.ide ? `its ${ideName(s.ide)} tab` : "its terminal";
  const move = async () => {
    const r = (await act(`${s.pid}:move`, `/api/sessions/${s.pid}/move`)) as { ok: boolean; pid?: number };
    setAsking(false);
    if (r.ok && r.pid) setState({ drawer: r.pid, selected: r.pid, typeInto: r.pid });
  };
  return (
    <div className="move-card">
      <div className="move-text">
        <b>Type to it from here</b>
        <span>
          {!tmuxReady
            ? "Control Room runs sessions in tmux. Install it to move this one here: brew install tmux"
            : asking
            ? `Claude Code stops in ${where} and continues the same conversation here, in a console. Nothing is lost.`
            : idle
              ? `Move it to Control Room to get a console here. Then ${where} is no longer needed.`
              : "It can move to Control Room once it is idle."}
        </span>
      </div>
      {asking ? (
        <div className="move-buttons">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !idle} onClick={() => void move()}>
            {busy ? "Moving…" : "Move"}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" disabled={!idle || !tmuxReady} onClick={() => setAsking(true)}>
          <ArrowDownToLine size={14} /> Move here
        </button>
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

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const CURSOR: Record<Edge, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

/**
 * The console with edges and corners to drag, like a window's. Up, down, left or right away from the console makes it
 * bigger. Its width is the details panel's, so a side edge resizes the panel. A double-click on an edge resets it.
 */
function ConsoleFrame(props: { edges: "all" | "ends" | "none"; height: number | null; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const edges: Edge[] = props.edges === "all" ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"] : props.edges === "ends" ? ["n", "s"] : [];
  const start = (edge: Edge, e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const h0 = r.height;
    // The console grows downward, so its bottom, where Claude Code's prompt is, stays on screen.
    const tallest = window.innerHeight - r.top - 16;
    const w0 = box.current!.closest(".drawer")?.getBoundingClientRect().width ?? 0;
    dragFrom(e, CURSOR[edge], (dx, dy) => {
      if (edge.includes("s")) setConsoleHeight(Math.min(tallest, h0 + dy));
      if (edge.includes("n")) setConsoleHeight(Math.min(tallest, h0 - dy));
      if (edge.includes("e")) setDrawerWidth("wide", w0 + dx);
      if (edge.includes("w")) setDrawerWidth("wide", w0 - dx);
    });
  };
  const reset = (edge: Edge) => {
    if (edge.includes("n") || edge.includes("s")) setConsoleHeight(null);
    if (edge.includes("e") || edge.includes("w")) setDrawerWidth("wide", null);
    keepSizes();
  };
  return (
    // A saved height is what it wants; with less room, in a smaller window or another layout, it gives way.
    <div className="console-frame" ref={box} style={props.height ? { flex: `0 1 ${props.height}px`, minHeight: 0 } : undefined}>
      {props.children}
      {edges.map((edge) => (
        <div key={edge} className={`console-edge edge-${edge}`} aria-hidden onPointerDown={(e) => start(edge, e)} onDoubleClick={() => reset(edge)} />
      ))}
    </div>
  );
}

export function SessionDetail({ s, variant }: { s: Session; variant: "drawer" | "focus" | "popout" }) {
  const now = useNow();
  const a = s.activity;
  const g = s.git;
  const [showClaims, setShowClaims] = useState(false);
  const renaming = useStore((st) => st.renaming === s.pid);
  const openIn = useOpenName(s);
  const ide = useIdeName();
  const tmuxName = consoleName(s);
  const typeInto = useStore((st) => st.typeInto === s.pid);
  // In the focus layout a console gets the room: the header is one row, with the buttons beside it.
  const compact = variant === "focus" && !!tmuxName;
  const consoleView = useStore((st) => (tmuxName ? st.consoleView : "normal"));
  // A height you dragged applies in the details; folded or filling the window, the console has its own size.
  const consoleHeight = useStore((st) => (tmuxName && consoleView === "normal" && variant !== "popout" ? st.consoleHeight : null));
  // A maximized console belongs to this session: the next one opens with its details.
  useEffect(() => () => void (getState().consoleView === "max" && setState({ consoleView: "normal" })), []);
  const where = tmuxName
    ? "Control Room"
    : s.tmux
      ? `tmux ${s.tmux.split(":")[0]}`
      : s.ide
        ? `${ideName(s.ide)} terminal${s.vscodeLinked ? " (linked)" : ""}`
        : "Terminal";
  const head = (
    <div className={`detail-head ${compact ? "is-compact" : ""}`}>
      <div className="detail-status">
        <StatusOrb kind={a.kind} size={12} />
        <span className="detail-status-label">{a.label}</span>
        <span className="detail-status-time">· {duration(now - a.since)}</span>
        <AccountChip s={s} />
        {variant === "drawer" && (
          <button type="button" className="icon-btn detail-close" aria-label="Close details" data-tip={withKey("Close details", "back")} data-tip-side="bottom" onClick={() => setState({ drawer: null })}>
            <X size={16} />
          </button>
        )}
      </div>
      <div className="detail-title-row">
        {renaming ? <NameEditor s={s} className="detail-title" onDone={() => setState({ renaming: null })} /> : <h2 className="detail-title">{s.name}</h2>}
        {!renaming && <RenameButton s={s} onClick={() => setState({ renaming: s.pid })} />}
      </div>
      {compact ? (
        // A native tip: the line clips anything drawn outside it.
        <p className="detail-line" title={s.summary.headline}>
          {(a.kind === "working" && a.detail) || s.summary.now || (s.nameSource !== "summary" ? s.summary.headline : "")}
        </p>
      ) : (
        <>
          {s.nameSource !== "summary" && <p className="detail-headline">{s.summary.headline}</p>}
          {s.summary.now && <p className="detail-now">{s.summary.now}</p>}
          {a.detail && a.kind === "working" && <p className="detail-doing">{a.detail}</p>}
        </>
      )}
    </div>
  );
  const asks = (
    <>
      {a.kind === "approval" && <ApprovalCard s={s} />}
      {a.kind === "question" && <QuestionCard s={s} />}
    </>
  );
  const actions = (
    <div className="detail-actions">
      {!tmuxName && (
        <button type="button" className="btn btn-primary" onClick={() => void act(`${s.pid}:focus`, `/api/sessions/${s.pid}/focus`, {}, true)}>
          <CodeXml size={15} /> Open in {openIn}
        </button>
      )}
      {tmuxName && (
        <button type="button" className="btn btn-ghost" data-tip={withKey("Open its folder, to see the changes", "ide")} onClick={() => void openInIde(s)}>
          <CodeXml size={15} /> Open in {ide}
        </button>
      )}
      {!s.terminal && <RemoteButton s={s} look="button" />}
      {s.pr && (
        <button type="button" className="btn btn-ghost" data-tip={withKey(s.pr.title, "pr")} onClick={() => openUrl(s.pr!.url, { pid: s.pid })}>
          <GitPullRequest size={15} /> PR #{s.pr.number}
        </button>
      )}
      {s.story && (
        <button type="button" className="btn btn-ghost" onClick={() => openUrl(s.story!.url, { pid: s.pid })}>
          <SquareKanban size={15} /> Story
        </button>
      )}
      {s.artifacts[0] && (
        <button type="button" className="btn btn-ghost" data-tip={s.artifacts[0].title ?? "The page it published"} onClick={() => openUrl(s.artifacts[0].url, { pid: s.pid })}>
          <AppWindow size={15} /> Artifact
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-icon" data-tip="Show the folder in Finder" aria-label="Folder" onClick={() => void api("/api/open", { folder: g?.root ?? s.cwd })}>
        <FolderOpen size={15} />
      </button>
      {variant !== "popout" && (
        <button type="button" className="btn btn-ghost btn-icon" data-tip={withKey("Pop out to its own window", "popout")} aria-label="Pop out" onClick={() => popoutSession(s.pid)}>
          <PictureInPicture2 size={15} />
        </button>
      )}
      <button type="button" className="btn btn-danger-ghost detail-close-btn" data-tip={withKey(`Close ${s.terminal ? closeName(s) : "the session"}`, "close")} onClick={() => setState({ closing: s.pid })}>
        <X size={15} /> {s.terminal ? `Close ${closeName(s)}…` : "Close…"}
      </button>
    </div>
  );
  return (
    <div className={`detail detail-${variant} st-${a.kind} ${s.terminal ? "is-terminal" : ""} console-${consoleView} ${consoleHeight ? "console-sized" : ""}`}>
      {compact ? (
        <div className="detail-top">
          {head}
          {actions}
        </div>
      ) : (
        <>
          {head}
          {asks}
          {actions}
        </>
      )}
      {compact && asks}

      {tmuxName && (
        <div className="detail-console">
          <ConsoleFrame edges={consoleView !== "normal" || variant === "popout" ? "none" : variant === "drawer" ? "all" : "ends"} height={consoleHeight}>
            <Suspense fallback={<div className="console" />}>
              {/* One console per session: the next one on show starts fresh, and takes the keyboard when asked. */}
              <Console
                key={tmuxName}
                name={tmuxName}
                pid={s.pid}
                autoFocus={variant === "popout" || typeInto}
                onFocused={() => typeInto && setState({ typeInto: null })}
                title={s.name}
                view={consoleView}
                onView={(v) => setState({ consoleView: v })}
                onPopOut={variant === "popout" ? undefined : () => popoutSession(s.pid)}
              />
            </Suspense>
          </ConsoleFrame>
        </div>
      )}

      <div className={`detail-body ${tmuxName ? "is-compact" : ""}`}>
        <dl className="dl">
          {/* A terminal outside a repository has only its folder, which its header shows. */}
          {(!s.terminal || g) && (
            <Row label="Repository">
              {s.repoName}
              {g?.isWorktree && <span className="muted"> · worktree {folderName(g.root)}</span>}
            </Row>
          )}
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
              <PrChip pr={s.pr} pid={s.pid} /> <span className="muted">{s.pr.title}</span>
            </Row>
          )}
          {s.storyId && (
            <Row label="Story">
              <span className="mono">sc-{s.storyId}</span> {s.story ? <span>{s.story.name}</span> : <span className="muted">(add a Shortcut token in Settings)</span>}
              {s.story?.state && <span className="chip-state"> {s.story.state}</span>}
            </Row>
          )}
          {s.artifacts.length > 0 && (
            <Row label={s.artifacts.length === 1 ? "Artifact" : "Artifacts"}>
              {s.artifacts.map((p, i) => (
                <span key={p.url}>
                  {i > 0 && ", "}
                  <button type="button" className="link" onClick={() => openUrl(p.url, { pid: s.pid })}>
                    {p.title ?? "Untitled"}
                  </button>
                </span>
              ))}
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
          {!s.terminal && (
            <Row label="Runs with">
              <span className="tune-row">
                <TuneChips s={s} />
              </span>
              {s.contextPercent !== null && <span className="muted"> · context {Math.round(s.contextPercent)}%</span>}
              {money(s.costUsd) && <span className="muted"> · {money(s.costUsd)}</span>}
            </Row>
          )}
          <Row label="Started">
            {startedLabel(s.startedAt, now)} <span className="muted">· {duration(now - s.startedAt)} ago</span>
          </Row>
          <Row label="Runs in">
            {where} <span className="muted mono">· pid {s.pid}</span>
          </Row>
        </dl>

        {!tmuxName && (
          <>
            <MoveHere s={s} />
            <h4 className="detail-section">Conversation</h4>
            <Conversation pid={s.pid} />
          </>
        )}
      </div>
    </div>
  );
}
