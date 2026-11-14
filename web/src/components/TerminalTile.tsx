// A terminal started in Control Room, on the wall with the sessions: its screen in place of a conversation. Another
// coding agent, such as Codex, shows the same way, with its status read off that screen.
import { Bot, GitBranch, PictureInPicture2, SquareTerminal, X } from "lucide-react";
import { motion } from "motion/react";
import type { Session } from "../../../shared/types.ts";
import { popoutSession } from "../lib/native.ts";
import { closeName, openMenu, setState, useStore } from "../store.ts";
import { NameEditor, RenameButton, statusTime } from "./Monitor.tsx";
import { IconButton, StatusOrb, useNow } from "./Primitives.tsx";

export function TerminalTile({ s, index, selected }: { s: Session; index: number; selected: boolean }) {
  const now = useNow();
  const renaming = useStore((st) => st.renaming === s.pid && st.drawer !== s.pid);
  const menuOn = useStore((st) => st.menu?.pid === s.pid);
  const screen = s.terminal?.screen ?? [];
  const running = s.agent ? s.activity.kind === "working" : !!s.terminal?.command;
  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.8 }}
      className={`monitor is-terminal ${s.agent ? "is-agent" : ""} ${running ? "is-running" : ""} ${selected ? "is-selected" : ""} ${menuOn ? "has-menu" : ""}`}
      onClick={() => setState({ drawer: s.pid, selected: s.pid, typeInto: s.pid })}
      onContextMenu={(e) => openMenu(e, s.pid)}
      data-pid={s.pid}
      draggable
    >
      <div className="mon-screen" aria-hidden />
      <header className="mon-head">
        <span className="mon-key" data-tip={index < 9 ? `Press ${index + 1} or ⌘${index + 1} to select` : undefined}>{index + 1}</span>
        {s.agent ? <Bot size={15} className="term-mark" aria-label={s.agent.label} /> : <SquareTerminal size={15} className="term-mark" aria-label="Terminal" />}
        {renaming ? <NameEditor s={s} className="mon-title" onDone={() => setState({ renaming: null })} /> : <h3 className="mon-title">{s.name}</h3>}
        <div className="mon-actions">
          <RenameButton s={s} onClick={() => setState({ renaming: s.pid })} />
          <IconButton label="Pop out to its own window" keys="popout" onClick={() => popoutSession(s.pid)}>
            <PictureInPicture2 size={15} />
          </IconButton>
        </div>
        <IconButton label={`Close ${closeName(s)}…`} keys="close" tone="danger" onClick={() => setState({ closing: s.pid })}>
          <X size={15} />
        </IconButton>
      </header>

      <div className="term-screen" aria-label="Its screen">
        {screen.length ? screen.map((line, i) => <div key={i}>{line || " "}</div>) : <div className="muted">Starting…</div>}
      </div>

      <footer className="mon-foot">
        <StatusOrb kind={s.activity.kind} size={9} />
        <span className="foot-item">{s.activity.label}</span>
        <span className="foot-dot">· {statusTime(s, now)}</span>
        <span className="foot-dot">·</span>
        <span className="foot-item foot-repo mono" data-tip={s.cwd}>
          {s.summary.headline}
        </span>
        {s.git?.branch && (
          <span className="chip term-branch" data-tip={s.git.isWorktree ? `Worktree ${s.git.root}` : s.git.root}>
            <GitBranch size={12} />
            <span className="chip-text mono">{s.git.branch}</span>
          </span>
        )}
      </footer>
    </motion.article>
  );
}
