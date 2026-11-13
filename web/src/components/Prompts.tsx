// Your saved prompts: chips that fill New session's first message, a menu that pastes one into a console, and the
// list in Settings where you change them.
import { BookmarkPlus, Copy, MessageSquareText, Play, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { EFFORTS, MODELS, MODES } from "../../../shared/claude.ts";
import { MAX_PROMPT_TEXT, MAX_PROMPT_TITLE, promptText, promptTune } from "../../../shared/prompts.ts";
import type { ActionResult, SavedPrompt } from "../../../shared/types.ts";
import { act, api, setState, toast, useStore } from "../store.ts";
import { Popover } from "./Tuning.tsx";

const NO_PROMPTS = [] as SavedPrompt[];

export function usePrompts(): SavedPrompt[] {
  return useStore((s) => s.snapshot?.settings.prompts ?? NO_PROMPTS);
}

/** What a tip shows of a prompt: its start, enough to tell it apart. */
function preview(text: string): string {
  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

/** What a prompt starts a session on, e.g. "Opus · high · plan", or "" when it leaves all three to you. */
export function tuneLabel(p: SavedPrompt): string {
  const t = promptTune(p);
  const label = (list: typeof MODELS, id?: string) => (id ? (list.find((c) => c.id === id)?.label ?? id) : null);
  return [label(MODELS, t.model), label(EFFORTS, t.effort), label(MODES, t.mode)].filter(Boolean).join(" · ");
}

/** Chips above New session's first message; a click puts that prompt in it, and sets what it asks to run on. */
export function PromptChips({ prompts, onPick }: { prompts: SavedPrompt[]; onPick: (p: SavedPrompt) => void }) {
  if (!prompts.length) return null;
  return (
    <div className="prompt-chips" aria-label="Saved prompts">
      {prompts.map((p) => (
        <button key={p.id} type="button" className="prompt-chip" data-tip={tuneLabel(p) ? `${tuneLabel(p)}\n\n${preview(p.text)}` : preview(p.text)} onClick={() => onPick(p)}>
          <span>{p.title}</span>
        </button>
      ))}
    </div>
  );
}

/** Saves the text you typed as a prompt; shown only while there is text that is not saved yet. */
export function SavePromptButton({ text, prompts }: { text: string; prompts: SavedPrompt[] }) {
  const busy = useStore((s) => !!s.busy.savePrompt);
  const clean = promptText(text);
  if (!clean || prompts.some((p) => p.text === clean)) return null;
  return (
    <button type="button" className="link prompt-save" disabled={busy} data-tip="Keep it for next time. Rename or delete it in Settings." onClick={() => void act("savePrompt", "/api/settings", { savePrompt: { text } })}>
      <BookmarkPlus size={13} /> Save as prompt
    </button>
  );
}

/** Settings, scrolled to the saved prompts. */
function editPrompts(): void {
  setState({ panel: "settings" });
  setTimeout(() => document.getElementById("saved-prompts")?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
}

/**
 * The Prompts pill in the top bar. A click copies a prompt, for a session anywhere: a VS Code or Terminal tab has no
 * console here to paste it in. The play button starts a new session with it instead.
 */
export function PromptsPill() {
  const prompts = usePrompts();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const copy = (p: SavedPrompt) => {
    close();
    void navigator.clipboard.writeText(p.text).then(
      () => toast(`Copied “${p.title}”. Paste it in any session.`, "ok"),
      () => toast("Could not copy it. Try again.", "error"),
    );
  };
  return (
    <>
      <button
        type="button"
        className={`pill-toggle ${anchor ? "is-on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        data-tip={anchor ? undefined : "Your saved prompts: copy one, or start a session with it"}
        data-tip-side="bottom"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <MessageSquareText size={14} />
        <span>Prompts</span>
        <span className="pill-state">{prompts.length}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close}>
          <div className="menu-title">Saved prompts</div>
          {!prompts.length && <div className="menu-note">None yet. Type one in New session and click Save as prompt, or add one here.</div>}
          {prompts.map((p) => (
            <div key={p.id} className="prompt-pick">
              <button type="button" role="menuitem" className="menu-item prompt-item" data-tip="Copy it" onClick={() => copy(p)}>
                <span className="prompt-item-title">
                  {p.title} {tuneLabel(p) && <span className="muted">· {tuneLabel(p)}</span>}
                </span>
                <span className="menu-meta prompt-item-text">{p.text}</span>
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`New session with ${p.title}`}
                data-tip="Start a new session with it"
                onClick={() => {
                  close();
                  setState({ draft: p.text, draftTune: promptTune(p), panel: "new" });
                }}
              >
                <Play size={13} />
              </button>
            </div>
          ))}
          <div className="menu-note prompt-foot">
            <Copy size={12} /> Click one to copy it.
            <button
              type="button"
              className="link"
              onClick={() => {
                close();
                editPrompts();
              }}
            >
              Add or edit prompts
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

/** A console's prompt menu: a pick is pasted at Claude Code's prompt, not sent, so you can change it first. */
export function PromptMenu({ onPick }: { onPick: (text: string) => void }) {
  const prompts = usePrompts();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  return (
    <>
      <button
        type="button"
        aria-label="Saved prompts"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        data-tip={anchor ? undefined : "Saved prompts: paste one in"}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <MessageSquareText size={14} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close}>
          <div className="menu-title">Saved prompts</div>
          {!prompts.length && <div className="menu-note">None yet. Type one in New session and click Save as prompt, or add one in Settings.</div>}
          {prompts.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              className="menu-item prompt-item"
              onClick={() => {
                close();
                onPick(p.text);
              }}
            >
              <span className="prompt-item-title">{p.title}</span>
              <span className="menu-meta prompt-item-text">{p.text}</span>
            </button>
          ))}
          <div className="menu-note">
            Pasted at the prompt, not sent: press Enter to send it.{" "}
            <button
              type="button"
              className="link"
              onClick={() => {
                close();
                editPrompts();
              }}
            >
              Edit prompts
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

/** One saved prompt in Settings. Saved when you leave a field; a change the server refuses goes back. */
function PromptRow({ p }: { p: SavedPrompt }) {
  const [sure, setSure] = useState(false); // a delete takes a second click, so one slip loses nothing
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(t);
  }, [sure]);
  const [title, setTitle] = useState(p.title);
  const [text, setText] = useState(p.text);
  // Only when the saved one changes: the snapshot comes again every few seconds, and must not undo your typing.
  useEffect(() => setTitle(p.title), [p.title]);
  useEffect(() => setText(p.text), [p.text]);
  const commit = () => {
    if (title.trim() === p.title && promptText(text) === p.text) return;
    void api<ActionResult>("/api/settings", { savePrompt: { id: p.id, title, text } }).then(
      (r) => {
        if (r.ok) return;
        toast(r.message, "error");
        setTitle(p.title);
        setText(p.text);
      },
      () => {
        setTitle(p.title);
        setText(p.text);
      },
    );
  };
  return (
    <div className="prompt-row">
      <div className="prompt-row-head">
        <input
          className="input"
          aria-label="Prompt name"
          placeholder="Name (the first words when empty)"
          maxLength={MAX_PROMPT_TITLE}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        {sure ? (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => void act(`prompt:${p.id}`, "/api/settings", { removePrompt: p.id })}>
            Delete
          </button>
        ) : (
          <button type="button" className="icon-btn" aria-label={`Delete ${p.title}`} data-tip="Delete" onClick={() => setSure(true)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <textarea className="input textarea" aria-label="Prompt text" rows={3} maxLength={MAX_PROMPT_TEXT} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      <PromptTuneRow p={p} />
    </div>
  );
}

const TUNE_PICKS = [
  { key: "model", label: "Model", choices: MODELS },
  { key: "effort", label: "Effort", choices: EFFORTS },
  { key: "mode", label: "Mode", choices: MODES },
] as const;

/** What New session switches to when you pick this prompt. "Keep" leaves that one as New session has it. */
function PromptTuneRow({ p }: { p: SavedPrompt }) {
  const set = (key: (typeof TUNE_PICKS)[number]["key"], value: string) =>
    void api<ActionResult>("/api/settings", { savePrompt: { id: p.id, title: p.title, text: p.text, [key]: value } }).then(
      (r) => r.ok || toast(r.message, "error"),
      () => toast("Could not save it. Try again.", "error"),
    );
  return (
    <div className="prompt-tune">
      {TUNE_PICKS.map((t) => (
        <label key={t.key} className="prompt-tune-pick">
          <span className="muted">{t.label}</span>
          <select className="select" value={p[t.key] ?? ""} onChange={(e) => set(t.key, e.target.value)}>
            <option value="">Keep</option>
            {t.choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

export function PromptsSection({ prompts }: { prompts: SavedPrompt[] }) {
  const busy = useStore((s) => !!s.busy.addPrompt);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const r = await act("addPrompt", "/api/settings", { savePrompt: { title, text } });
    if (r.ok) {
      setTitle("");
      setText("");
    }
  };
  return (
    <>
      <h4 className="set-section" id="saved-prompts">
        Saved prompts
      </h4>
      <div className="set-line set-line-stack">
        <div className="set-text">
          <b>Your prompts</b>
          <span>
            One click puts one in New session's first message, and sets the model, effort and mode you chose for it. In a session's console, the speech-bubble button pastes one at its prompt. Prompts, at the top, copies one
            for a session anywhere. Changes save when you leave a field.
          </span>
        </div>
        <div className="prompt-list">
          {prompts.map((p) => (
            <PromptRow key={p.id} p={p} />
          ))}
          <form className="prompt-row prompt-add" onSubmit={(e) => void add(e)}>
            <input className="input" aria-label="New prompt name" placeholder="Name (optional)" maxLength={MAX_PROMPT_TITLE} value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className="input textarea" aria-label="New prompt text" rows={3} maxLength={MAX_PROMPT_TEXT} placeholder="A prompt you use often" value={text} onChange={(e) => setText(e.target.value)} />
            <div>
              <button type="submit" className="btn btn-ghost btn-sm" disabled={!promptText(text) || busy}>
                Add prompt
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
