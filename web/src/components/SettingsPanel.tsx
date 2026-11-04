import { Copy, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { IDES } from "../../../shared/ides.ts";
import type { Snapshot } from "../../../shared/types.ts";
import { playChime } from "../lib/alerts.ts";
import { native } from "../lib/native.ts";
import { act, api, setState, toast, useStore } from "../store.ts";
import { Toggle } from "./Primitives.tsx";

function Line(props: { title: string; text: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="set-line">
      <div className="set-text">
        <b>{props.title}</b>
        <span>{props.text}</span>
      </div>
      <div className="set-control">{props.children}</div>
    </div>
  );
}

function State({ ok, text }: { ok: boolean; text: string }) {
  return <span className={`state-dot ${ok ? "is-ok" : ""}`}>{text}</span>;
}

export function SettingsPanel({ snap }: { snap: Snapshot }) {
  const busy = useStore((s) => s.busy);
  const [token, setToken] = useState("");
  const [sudoers, setSudoers] = useState<string | null>(null);
  const [atLogin, setAtLogin] = useState<boolean | null>(null);
  useEffect(() => {
    void native?.loginItem().then(setAtLogin);
  }, []);
  const cfg = snap.settings;
  const setup = snap.setup;
  const save = (patch: object) => void api("/api/settings", patch);
  const close = () => setState({ panel: null });

  return (
    <div className="scrim" onClick={close}>
      <motion.div
        className="sheet sheet-narrow"
        role="dialog"
        aria-modal
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h2>Settings</h2>
            <p className="dialog-sub">Saved on this Mac in ~/.claude-control-room</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
            <X size={16} />
          </button>
        </div>

        <div className="set-body">
          <h4 className="set-section">Alerts</h4>
          <Line title="Desktop notifications" text="When a session needs you, or finishes while you look elsewhere.">
            <Toggle label="Desktop notifications" on={cfg.notifications} onChange={(on) => save({ notifications: on })} />
          </Line>
          <Line title="Sounds" text={<>A soft chime on the same moments. <button type="button" className="link" onClick={() => playChime("attention")}>Play “needs you”</button> · <button type="button" className="link" onClick={() => playChime("done")}>Play “finished”</button></>}>
            <Toggle label="Sounds" on={cfg.sounds} onChange={(on) => save({ sounds: on })} />
          </Line>

          {native && atLogin !== null && (
            <>
              <h4 className="set-section">Menu bar</h4>
              <Line title="Open at login" text="Control Room starts when you log in, so its icon is always in the menu bar. Click the icon for a quick look; right-click it for more.">
                <Toggle label="Open at login" on={atLogin} onChange={(on) => void native!.setLoginItem(on).then(setAtLogin)} />
              </Line>
            </>
          )}

          <h4 className="set-section">Sessions</h4>
          <Line title="Plain-English summaries" text="A short Haiku call describes each session's task for anyone to read. Uses your Claude plan, about 0.03¢ each.">
            <Toggle label="Plain-English summaries" on={cfg.aiSummaries} onChange={(on) => save({ aiSummaries: on })} />
          </Line>
          <Line title="Call a session inactive after" text="Idle sessions turn grey after this long.">
            <select className="select" value={cfg.inactiveAfterMinutes} onChange={(e) => save({ inactiveAfterMinutes: Number(e.target.value) })}>
              {[30, 60, 120, 240, 480, 1440].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : m === 1440 ? "1 day" : `${m / 60} h`}
                </option>
              ))}
            </select>
          </Line>
          <Line title="Open other sessions in" text="A session in an IDE's terminal opens in that IDE. The others open their folder in the IDE you pick here.">
            <select className="select" value={cfg.ide} onChange={(e) => save({ ide: e.target.value })}>
              {/* Every IDE stays listed: macOS can still find one that is not in Applications. */}
              {IDES.map((i) => (
                <option key={i.id} value={i.id}>
                  {setup.ides.includes(i.id) ? i.name : `${i.name} (not in Applications)`}
                </option>
              ))}
            </select>
          </Line>
          <Line title="Show VS Code panel sessions" text="Sessions in the Claude Code side panel of VS Code, not only terminal ones.">
            <Toggle label="Show VS Code panel sessions" on={cfg.includeIdePanel} onChange={(on) => save({ includeIdePanel: on })} />
          </Line>

          <h4 className="set-section">Connections</h4>
          <Line
            title="Claude Code"
            text={
              setup.statusLine === "installed" && setup.hooks
                ? "Connected: usage limits, model, effort, context and what each approval asks reach the dashboard."
                : setup.statusLine === "foreign"
                  ? "You have your own status line. Connecting keeps it showing, adds a quiet permission hook, and reads the data. Your settings are backed up first."
                  : "Adds a small status line and a quiet background permission hook to ~/.claude/settings.json, so usage, model, effort and each approval's details reach the dashboard. Your settings are backed up first."
            }
          >
            {setup.statusLine === "installed" && setup.hooks ? (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy.statusline} onClick={() => void act("statusline", "/api/setup/statusline", { install: false })}>
                Disconnect
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy.statusline} onClick={() => void act("statusline", "/api/setup/statusline", { install: true })}>
                Connect
              </button>
            )}
          </Line>
          <Line
            title="VS Code helper"
            text={
              setup.vscodeHelper === "connected"
                ? `Connected to ${setup.vscodeWindows} VS Code window${setup.vscodeWindows === 1 ? "" : "s"}. Jump to a session's terminal, approve and rename from here.`
                : setup.vscodeHelper === "outdated"
                  ? "Connected, but this helper is too old to rename tabs. Update it, then run “Developer: Restart Extension Host” in VS Code."
                  : setup.vscodeHelper === "installed"
                    ? "Installed, waiting for VS Code. Run “Developer: Reload Window” in VS Code if it does not connect."
                    : "A tiny VS Code extension that finds the terminal of each session."
            }
          >
            {setup.vscodeHelper === "connected" ? (
              <State ok text="Connected" />
            ) : (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy.vscode} onClick={() => void act("vscode", "/api/setup/vscode")}>
                {setup.vscodeHelper === "outdated" ? "Update" : setup.vscodeHelper === "installed" ? "Reinstall" : "Install"}
              </button>
            )}
          </Line>
          <Line title="GitHub" text="Pull requests and checks come from the GitHub CLI (gh).">
            <State ok={setup.ghReady} text={setup.ghReady ? "Signed in" : "Run gh auth login"} />
          </Line>
          <div className="set-line set-line-stack">
            <div className="set-text">
              <b>Shortcut</b>
              <span>
                Optional. Shows the story a session works on (found from <span className="mono">sc-12345</span> in the branch, notes or chat). Add one API token per
                workspace: Shortcut → Settings → API Tokens.
              </span>
            </div>
            <div className="token-list">
              {cfg.shortcutTokens.map((t, i) => (
                <span key={t + i} className="token">
                  <span className="mono">{t}</span>
                  <button type="button" className="icon-btn" aria-label="Remove token" onClick={() => save({ removeShortcutToken: i })}>
                    <X size={13} />
                  </button>
                </span>
              ))}
              <form
                className="token-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!token.trim()) return;
                  void act("shortcut", "/api/settings", { addShortcutToken: token.trim() }).then((r) => r.ok && setToken(""));
                }}
              >
                <input className="input" type="password" placeholder="Paste a Shortcut API token" value={token} onChange={(e) => setToken(e.target.value)} />
                <button type="submit" className="btn btn-ghost btn-sm" disabled={!token.trim() || busy.shortcut}>
                  Add
                </button>
              </form>
            </div>
          </div>

          <h4 className="set-section">Keep awake</h4>
          <div className="set-line set-line-stack">
            <div className="set-text">
              <b>No password prompt</b>
              <span>
                {snap.power.passwordless
                  ? "Set up: the keep-awake switch works without asking for your password."
                  : "The switch runs “pmset -a disablesleep”, so macOS asks for your password each time. To skip that, add one sudoers rule that allows only these two commands:"}
              </span>
            </div>
            {!snap.power.passwordless && (
              <div className="code-box">
                {sudoers ? (
                  <>
                    <code className="mono">{`echo '${sudoers}' | sudo tee /etc/sudoers.d/control-room-pmset && sudo chmod 440 /etc/sudoers.d/control-room-pmset`}</code>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Copy"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(`echo '${sudoers}' | sudo tee /etc/sudoers.d/control-room-pmset && sudo chmod 440 /etc/sudoers.d/control-room-pmset`)
                          .then(() => toast("Copied. Paste it in Terminal.", "ok"))
                      }
                    >
                      <Copy size={14} />
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api<{ message: string }>("/api/power/sudoers", {}).then((r) => setSudoers(r.message))}>
                    Show the command
                  </button>
                )}
              </div>
            )}
          </div>

          <h4 className="set-section">Keyboard</h4>
          <div className="keys">
            <span><kbd className="kbd">1</kbd>–<kbd className="kbd">9</kbd> select a session</span>
            <span><kbd className="kbd">↵</kbd> open it</span>
            <span><kbd className="kbd">Space</kbd> details</span>
            <span><kbd className="kbd">A</kbd> approve · <kbd className="kbd">R</kbd> reject</span>
            <span><kbd className="kbd">P</kbd> open its PR</span>
            <span><kbd className="kbd">X</kbd> close session…</span>
            <span><kbd className="kbd">F</kbd> focus layout</span>
            <span><kbd className="kbd">Esc</kbd> close panels</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
