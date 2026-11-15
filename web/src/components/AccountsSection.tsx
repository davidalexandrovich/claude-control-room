// Claude accounts besides the usual one, in Settings. Each keeps its own login in its own Claude Code config folder.
import { Pencil, UserRound, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { claudeCommand, MAX_ACCOUNTS } from "../../../shared/claude.ts";
import type { OtherAccount, Snapshot } from "../../../shared/types.ts";
import { act, useStore } from "../store.ts";
import { FolderField } from "./FolderField.tsx";

/** An account's name, shown on the filters, its sessions and its usage: click it to change it. */
function AccountName({ label, onSave }: { label: string; onSave: (label: string) => void }) {
  const [value, setValue] = useState<string | null>(null);
  // Enter or Esc ends it, and the blur that follows must not end it again.
  const ended = useRef(false);
  if (value === null) {
    return (
      <button
        type="button"
        className="account-name"
        data-tip="Rename it"
        onClick={() => {
          ended.current = false;
          setValue(label);
        }}
      >
        <b>{label}</b>
        <Pencil size={11} />
      </button>
    );
  }
  const done = (keep: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (keep && value.trim() !== label) onSave(value.trim());
    setValue(null);
  };
  return (
    <input
      className="input account-name-input"
      autoFocus
      value={value}
      maxLength={30}
      aria-label="Account name"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(true);
        else if (e.key === "Escape") done(false);
      }}
      onBlur={() => done(true)}
    />
  );
}

export function AccountsSection({ snap }: { snap: Snapshot }) {
  const busy = useStore((s) => s.busy);
  const others = snap.otherAccounts;
  // The first one is most likely the personal account, so its form comes filled in.
  const [label, setLabel] = useState(others.length ? "" : "Personal");
  const [dir, setDir] = useState(others.length ? "" : "~/.claude-personal");

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !dir.trim()) return;
    const r = await act("account-add", "/api/settings", { addAccount: { label: label.trim(), dir: dir.trim() } });
    if (r.ok) {
      setLabel("");
      setDir("");
    }
  };
  const signIn = (a: OtherAccount) => void act(`account:${a.dir}`, "/api/account/switch", { dir: a.dir });
  const remove = (a: OtherAccount) => void act(`account:${a.dir}`, "/api/settings", { removeAccount: a.dir });
  // Left empty, the usual account is "Default" again; another one keeps its name.
  const renameUsual = (label: string) => void act("account-name", "/api/settings", { defaultAccountLabel: label }, true);
  const rename = (a: OtherAccount, label: string) => label && void act(`account:${a.dir}`, "/api/settings", { renameAccount: { dir: a.dir, label } }, true);
  const startOn = (dir: string) => void act("account-new", "/api/settings", { newSessionAccount: dir }, true);
  // Where New session and a terminal start on this account: "" is the usual one. Left empty, the last folder you used.
  const folder = (account: string, label: string) => (
    <FolderField
      value={snap.settings.accountFolders[account] ?? ""}
      label={`${label}: start folder`}
      placeholder="Start folder, ~/code"
      save={(text) => ({ accountFolder: { account, folder: text } })}
    />
  );

  return (
    <>
      <h4 className="set-section">Claude accounts</h4>
      <div className="set-line set-line-stack">
        <div className="set-text">
          <b>Other accounts</b>
          <span>
            A personal account next to your work one, say. Each keeps its own login, settings and conversations in its own folder. Sessions from every account show
            here, marked with the account's name, and New session asks which one to use. Give one a start folder, and New session and Terminal open
            there while you are on its tab.
          </span>
        </div>
        <div className="account-list">
          <div className="account-item">
            <UserRound size={15} />
            <div className="account-item-text">
              <AccountName label={snap.settings.defaultAccountLabel} onSave={renameUsual} />
              <span>{snap.account.email ?? "Not signed in"} · ~/.claude</span>
            </div>
            {folder("", snap.settings.defaultAccountLabel)}
          </div>
          {others.map((a) => (
            <div key={a.dir} className="account-item">
              <UserRound size={15} className="tone-account" />
              <div className="account-item-text">
                <AccountName label={a.label} onSave={(label) => rename(a, label)} />
                <span data-tip={a.dir}>
                  {a.loggedIn ? (a.email ?? "Signed in") : "Not signed in"} · {a.dir}
                </span>
              </div>
              {folder(a.dir, a.label)}
              <button
                type="button"
                className={`btn btn-sm ${a.loggedIn ? "btn-ghost" : "btn-primary"}`}
                disabled={busy[`account:${a.dir}`]}
                data-tip={`${a.loggedIn ? "Sign in with another claude.ai account" : "Sign in"}, in a private browser window: your browser's own claude.ai stays as it is`}
                onClick={() => signIn(a)}
              >
                {a.loggedIn ? "Switch" : "Sign in"}
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${a.label}`}
                data-tip="Remove it from Control Room. Its folder and login stay."
                disabled={busy[`account:${a.dir}`]}
                onClick={() => remove(a)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {others.length < MAX_ACCOUNTS && (
            <form className="account-form" onSubmit={(e) => void add(e)}>
              <input className="input" aria-label="Account name" placeholder="Name, such as Personal" value={label} maxLength={30} onChange={(e) => setLabel(e.target.value)} />
              <input className="input mono" aria-label="Its folder" placeholder="~/.claude-personal" value={dir} onChange={(e) => setDir(e.target.value)} />
              <button type="submit" className="btn btn-ghost btn-sm" disabled={!label.trim() || !dir.trim() || busy["account-add"]}>
                Add
              </button>
            </form>
          )}
          {others[0] && (
            <p className="field-hint">
              To start one in a terminal yourself: <span className="mono">{claudeCommand(others[0])}</span>
            </p>
          )}
        </div>
      </div>
      {others.length > 0 && (
        <div className="set-line">
          <div className="set-text">
            <b>New sessions start on</b>
            <span>The account New session picks on All accounts. On one account's tab it picks that account. You can still pick another one there, for that session.</span>
          </div>
          <div className="set-control">
            <select className="select" aria-label="New sessions start on" value={snap.settings.newSessionAccount} onChange={(e) => startOn(e.target.value)}>
              <option value="">{snap.settings.defaultAccountLabel}</option>
              {others.map((a) => (
                <option key={a.dir} value={a.dir}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </>
  );
}
