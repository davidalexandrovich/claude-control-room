import { FolderOpen, Plus, TerminalSquare } from "lucide-react";
import { motion } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MODE, EFFORTS, MODELS, MODES } from "../../../shared/claude.ts";
import type { ActionResult, Snapshot } from "../../../shared/types.ts";
import { folderName } from "../lib/format.ts";
import { native } from "../lib/native.ts";
import { api, consoleName, remember, setState, stored, toast } from "../store.ts";
import { PromptChips, SavePromptButton, usePrompts } from "./Prompts.tsx";

const Console = lazy(() => import("./Console.tsx"));

/** Folders worth offering: the last ones you started in, then the folders your sessions work in, newest first. */
function folderChoices(snap: Snapshot): string[] {
  const recent = stored<string[]>("cr.recentFolders", []);
  const fromSessions = [...snap.sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt).map((s) => s.git?.root ?? s.cwd);
  return [...new Set([...recent, ...fromSessions])].slice(0, 20);
}

export function NewSessionDialog({ snap }: { snap: Snapshot }) {
  const choices = useMemo(() => folderChoices(snap), []);
  const [cwd, setCwd] = useState(choices[0] ?? "");
  const [typed, setTyped] = useState(choices.length === 0 && !native);
  const [prompt, setPrompt] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const prompts = usePrompts();
  // A saved prompt fills an empty message, or goes after what is there. The caret goes to the end, so Enter starts it.
  const pickPrompt = (text: string) => {
    const next = prompt.trim() ? `${prompt.trimEnd()}\n\n${text}` : text;
    setPrompt(next);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
      el.scrollTop = el.scrollHeight;
    });
  };
  // Empty means Claude Code's own default. The last choice is kept for next time.
  const [tune, setTune] = useState(() => stored("cr.newSessionTune", { model: "", effort: "", mode: DEFAULT_MODE }));
  const setTuned = (part: Partial<typeof tune>) => setTune((t) => ({ ...t, ...part }));
  // The config folder of another account, or "" for the usual one. Each time the one from Settings, not the last choice:
  // one session on a personal account must not put the next ones there too.
  const [account, setAccount] = useState(() => {
    const first = snap.settings.newSessionAccount;
    return snap.otherAccounts.some((a) => a.dir === first) ? first : "";
  });
  const chosen = snap.otherAccounts.find((a) => a.dir === account) ?? null;
  const [starting, setStarting] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null); // a console that must be answered before the session shows
  const open = useRef(true);
  useEffect(() => () => void (open.current = false), []);
  const close = () => setState({ panel: null });
  // A session that still waits for its first answer shows nowhere else, so leaving the dialog stops it.
  const cancel = () => {
    if (waiting) void api(`/api/console/${waiting}/stop`, {});
    close();
  };

  // Esc in the console goes to Claude Code; anywhere else it closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !waiting) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [waiting]);

  // Once Claude Code has started for real, the session shows in the list: open it there.
  useEffect(() => {
    const s = waiting ? snap.sessions.find((x) => consoleName(x) === waiting) : null;
    if (s) setState({ panel: null, drawer: s.pid, selected: s.pid, typeInto: s.pid });
  }, [waiting, snap]);

  const pick = async () => {
    const path = await native?.pickFolder();
    if (path) setCwd(path);
  };

  const canStart = !!cwd.trim() && !starting && snap.setup.tmuxReady;
  // Enter starts it, as in Claude Code; Shift+Enter is a new line. Not while an input method still composes a word.
  const enterStarts = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void start();
  };

  const start = async () => {
    if (!canStart) return;
    setStarting(true);
    const r = await api<ActionResult & { pid?: number; name?: string }>("/api/sessions/new", { cwd: cwd.trim(), prompt, ...tune, account: account || undefined }).catch(
      (err: Error) => ({ ok: false, message: err.message }) as ActionResult & { pid?: number; name?: string },
    );
    // Closed while it started: the session runs, and shows in the list, but nothing jumps at you.
    if (!open.current) return void (r.ok && toast(r.pid ? "Started" : r.message, "ok"));
    setStarting(false);
    if (!r.ok) return toast(r.message, "error");
    remember("cr.newSessionTune", tune);
    remember("cr.recentFolders", [cwd.trim(), ...stored<string[]>("cr.recentFolders", []).filter((f) => f !== cwd.trim())].slice(0, 8));
    if (r.pid) setState({ panel: null, drawer: r.pid, selected: r.pid, typeInto: r.pid });
    else if (r.name) setWaiting(r.name);
  };

  return (
    <div className="scrim" onClick={waiting ? undefined : close}>
      <motion.div
        className={`dialog new-session ${waiting ? "is-waiting" : ""}`}
        role="dialog"
        aria-modal
        aria-labelledby="new-title"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
      >
        {waiting ? (
          <>
            <h2 id="new-title">Claude Code asks something first</h2>
            <p className="dialog-sub">Answer it here. The session opens as soon as it starts.</p>
            <div className="new-console">
              <Suspense fallback={null}>
                <Console name={waiting} account={account} autoFocus />
              </Suspense>
            </div>
            <div className="dialog-buttons">
              <button type="button" className="btn btn-ghost" onClick={cancel}>
                Cancel and stop it
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="new-title">New session</h2>
            <p className="dialog-sub">Claude Code starts in Control Room. You type to it in its console here, no terminal needed.</p>

            <label className="field">
              <span className="field-label">Folder</span>
              <div className="field-row">
                {typed ? (
                  <input className="input mono" placeholder="/Users/you/code/project" value={cwd} autoFocus onChange={(e) => setCwd(e.target.value)} onKeyDown={enterStarts} />
                ) : (
                  <select className="select field-grow" value={cwd} onChange={(e) => setCwd(e.target.value)}>
                    {!choices.includes(cwd) && cwd && <option value={cwd}>{folderName(cwd)} · {cwd}</option>}
                    {choices.map((f) => (
                      <option key={f} value={f}>
                        {folderName(f)} · {f}
                      </option>
                    ))}
                  </select>
                )}
                {native ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void pick()}>
                    <FolderOpen size={14} /> Choose…
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTyped((v) => !v)}>
                    {typed ? "Pick from list" : "Type a path"}
                  </button>
                )}
              </div>
            </label>

            {snap.otherAccounts.length > 0 && (
              <label className="field">
                <span className="field-label">Account</span>
                <select className="select" value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option value="">
                    {snap.settings.defaultAccountLabel} · {snap.account.email ?? "not signed in"}
                  </option>
                  {snap.otherAccounts.map((a) => (
                    <option key={a.dir} value={a.dir}>
                      {a.label} · {a.loggedIn ? (a.email ?? "signed in") : "not signed in"}
                    </option>
                  ))}
                </select>
                {chosen && !chosen.loggedIn && <span className="field-hint">Not signed in yet. Claude Code asks you to sign in, in the console here.</span>}
              </label>
            )}

            <div className="field">
              <div className="field-label field-label-row">
                <label htmlFor="new-first-message">
                  First message <span className="muted">optional</span>
                </label>
                <SavePromptButton text={prompt} prompts={prompts} />
              </div>
              <PromptChips prompts={prompts} onPick={pickPrompt} />
              <textarea
                id="new-first-message"
                ref={area}
                className="input textarea"
                rows={4}
                placeholder="What should Claude work on? Enter starts it, Shift+Enter adds a line."
                value={prompt}
                autoFocus={!typed}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={enterStarts}
              />
            </div>

            <div className="field-trio">
              <label className="field">
                <span className="field-label">Model</span>
                <select className="select" value={tune.model} onChange={(e) => setTuned({ model: e.target.value })}>
                  <option value="">Your default</option>
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Effort</span>
                <select className="select" value={tune.effort} onChange={(e) => setTuned({ effort: e.target.value })}>
                  <option value="">Your default</option>
                  {EFFORTS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Mode</span>
                <select className="select" value={tune.mode} onChange={(e) => setTuned({ mode: e.target.value })}>
                  {MODES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="field-hint">{MODES.find((m) => m.id === tune.mode)?.hint}. Change any of these later from the session's card.</p>

            {!snap.setup.tmuxReady && (
              <p className="field-warn">
                <TerminalSquare size={14} /> Control Room runs sessions in tmux. Install it first: <span className="mono">brew install tmux</span>
              </p>
            )}

            <div className="dialog-buttons">
              <button type="button" className="btn btn-ghost" onClick={close}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={!canStart} onClick={() => void start()}>
                <Plus size={15} /> {starting ? "Starting…" : "Start session"}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
