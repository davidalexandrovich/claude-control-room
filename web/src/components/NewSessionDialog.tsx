import { FolderOpen, Plus, TerminalSquare, X } from "lucide-react";
import { motion } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MODE, EFFORTS, MODELS, MODES } from "../../../shared/claude.ts";
import { fillSlots, pickPrompt as pickInto, promptSlots } from "../../../shared/prompts.ts";
import type { ActionResult, SavedPrompt, Snapshot } from "../../../shared/types.ts";
import { folderName } from "../lib/format.ts";
import { native } from "../lib/native.ts";
import { api, consoleName, getState, remember, setState, stored, toast } from "../store.ts";
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
  const draft = useMemo(() => getState().draft, []);
  const [prompt, setPrompt] = useState(draft?.text ?? "");
  // Taken once: the next New session opens empty again.
  useEffect(() => {
    if (getState().draft) setState({ draft: null });
  }, []);
  const area = useRef<HTMLTextAreaElement>(null);
  const prompts = usePrompts();
  // Empty means Claude Code's own default. The last choice you made yourself is kept for next time: one a saved prompt
  // set is for that prompt only, so Plan ticket's plan mode never becomes how every session starts.
  const [mine, setMine] = useState(() => stored("cr.newSessionTune", { model: "", effort: "", mode: DEFAULT_MODE }));
  const withPrompt = (t: typeof mine, p: SavedPrompt | null) => (p ? { model: p.model || t.model, effort: p.effort || t.effort, mode: p.mode || t.mode } : t);
  const [tune, setTune] = useState(() => withPrompt(mine, draft));
  const [setBy, setSetBy] = useState<string | null>(draft && (draft.model || draft.effort || draft.mode) ? draft.title : null);
  const setTuned = (part: Partial<typeof tune>) => {
    setTune((t) => ({ ...t, ...part }));
    setMine((t) => ({ ...t, ...part }));
    setSetBy(null);
  };
  // A slot in the message, as in "review <PR URL>", gets a line of its own to fill in; the message keeps the slot, and
  // what you type there goes in its place when the session starts.
  // A line closed with its × stays closed, its slot left for Claude to ask about, until another prompt is picked.
  const [closedSlots, setClosedSlots] = useState<string[]>([]);
  const slots = useMemo(() => promptSlots(prompt).filter((n) => !closedSlots.includes(n)), [prompt, closedSlots]);
  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const slotInput = (name: string) => document.querySelector<HTMLInputElement>(`.prompt-slot input[data-slot="${CSS.escape(name)}"]`);
  // The first slot still empty takes the keyboard; with none, the message does, its caret at the end, so Enter starts it.
  const focusNext = (text: string) =>
    requestAnimationFrame(() => {
      const empty = promptSlots(text).find((n) => !slotValues[n]?.trim() && !closedSlots.includes(n));
      if (empty) return void slotInput(empty)?.focus();
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
      el.scrollTop = el.scrollHeight;
    });
  useEffect(() => {
    if (draft) focusNext(draft.text);
  }, []);
  // The saved prompt in the message, and what you had typed ahead of it: another chip takes its place.
  const [picked, setPicked] = useState<{ prompt: SavedPrompt; base: string } | null>(draft ? { prompt: draft, base: "" } : null);
  // A chip puts its prompt in the message, in place of the one picked before, with its model, effort and mode on top of
  // yours; clicked again, it takes them out. The lines of the slots it brought go with it.
  const pickPrompt = (p: SavedPrompt) => {
    const next = pickInto(prompt, picked, p);
    setPrompt(next.message);
    setPicked(next.picked);
    setClosedSlots([]);
    const on = next.picked?.prompt ?? null;
    setTune(withPrompt(mine, on));
    setSetBy(on && (on.model || on.effort || on.mode) ? on.title : null);
    focusNext(next.message);
  };
  // Enter in a slot goes to the next one; in the last, it starts the session, as Enter does in the message.
  const slotKeys = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (i < slots.length - 1) slotInput(slots[i + 1])?.focus();
    else void start();
  };
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
    const r = await api<ActionResult & { pid?: number; name?: string }>("/api/sessions/new", { cwd: cwd.trim(), prompt: fillSlots(prompt, slotValues), ...tune, account: account || undefined }).catch(
      (err: Error) => ({ ok: false, message: err.message }) as ActionResult & { pid?: number; name?: string },
    );
    // Closed while it started: the session runs, and shows in the list, but nothing jumps at you.
    if (!open.current) return void (r.ok && toast(r.pid ? "Started" : r.message, "ok"));
    setStarting(false);
    if (!r.ok) return toast(r.message, "error");
    remember("cr.newSessionTune", mine);
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
                <SavePromptButton text={prompt} prompts={prompts} tune={tune} />
              </div>
              <PromptChips prompts={prompts} onPick={pickPrompt} picked={picked?.prompt.id ?? null} />
              {slots.length > 0 && (
                <div className="prompt-slots">
                  {slots.map((name, i) => (
                    <label key={name} className="prompt-slot">
                      <span>{name}</span>
                      <input
                        className="input"
                        data-slot={name}
                        spellCheck={false}
                        placeholder={`Goes where the message says <${name}>`}
                        value={slotValues[name] ?? ""}
                        onChange={(e) => setSlotValues((v) => ({ ...v, [name]: e.target.value }))}
                        onKeyDown={(e) => slotKeys(e, i)}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Close the ${name} line`}
                        data-tip={`Close this line. The message keeps <${name}>, for Claude to ask about.`}
                        onClick={(e) => {
                          e.preventDefault();
                          setClosedSlots((c) => [...c, name]);
                        }}
                      >
                        <X size={13} />
                      </button>
                    </label>
                  ))}
                </div>
              )}
              <textarea
                id="new-first-message"
                ref={area}
                className="input textarea"
                rows={4}
                placeholder="What should Claude work on? Enter starts it, Shift+Enter adds a line."
                value={prompt}
                autoFocus={!typed && !draft}
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
            <p className="field-hint">
              {setBy && <>Set by “{setBy}”. </>}
              {MODES.find((m) => m.id === tune.mode)?.hint}. Change any of these later from the session's card.
            </p>

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
