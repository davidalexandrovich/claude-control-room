// Coding agents besides Claude Code, in Settings: the built-in ones and whether they are installed, and your own.
import { Bot, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { Snapshot } from "../../../shared/types.ts";
import { act, useStore } from "../store.ts";

const INSTALL: Record<string, string> = {
  codex: "npm i -g @openai/codex",
  gemini: "npm i -g @google/gemini-cli",
  cursor: "curl https://cursor.com/install -fsS | bash",
  kimi: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
  ollama: "brew install ollama",
};

export function AgentsSection({ snap }: { snap: Snapshot }) {
  const busy = useStore((s) => !!s.busy.addAgent);
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const mine = new Set(snap.settings.agents.map((a) => a.id));
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const r = await act("addAgent", "/api/settings", { addAgent: { label, command } });
    if (r.ok) {
      setLabel("");
      setCommand("");
    }
  };
  return (
    <>
      <h4 className="set-section">Coding agents</h4>
      <div className="set-line set-line-stack">
        <div className="set-text">
          <b>Besides Claude Code</b>
          <span>
            Pick one under <b>Agent</b> in New session. It runs in a console here, and its tile shows Working while its screen moves. Approvals and settings stay in
            its own console. Sign in to each one there the first time.
          </span>
        </div>
        <div className="token-list">
          {snap.setup.agents.map((a) => (
            <span key={a.id} className="token agent-row">
              <span className="agent-name">
                <Bot size={13} /> <b>{a.label}</b>
                {!mine.has(a.id) && (a.installed ? <span className="muted"> · installed</span> : <span className="muted"> · not installed{INSTALL[a.id] && <>: <span className="mono">{INSTALL[a.id]}</span></>}</span>)}
                {mine.has(a.id) && <span className="muted mono"> · {snap.settings.agents.find((x) => x.id === a.id)?.command}</span>}
              </span>
              {mine.has(a.id) && (
                <button type="button" className="icon-btn" aria-label={`Remove ${a.label}`} onClick={() => void act(`agent:${a.id}`, "/api/settings", { removeAgent: a.id })}>
                  <X size={13} />
                </button>
              )}
            </span>
          ))}
          <form className="token-form agent-form" onSubmit={(e) => void add(e)}>
            <input className="input agent-label" aria-label="Agent name" placeholder="Name, e.g. Aider" maxLength={30} value={label} onChange={(e) => setLabel(e.target.value)} />
            <input
              className="input mono"
              aria-label="Agent command"
              placeholder="aider --model sonnet --message {prompt}"
              spellCheck={false}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <button type="submit" className="btn btn-ghost btn-sm" disabled={!label.trim() || !command.trim() || busy}>
              Add
            </button>
          </form>
          <span className="field-hint">The command runs in your login shell, in the folder you pick. {"{prompt}"} is where the first message goes; without it, the agent starts empty.</span>
        </div>
      </div>
    </>
  );
}
