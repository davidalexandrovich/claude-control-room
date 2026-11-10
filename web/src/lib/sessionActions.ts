// What a session's menu items do, shared with their keys: a click and a key press do the same thing.
import { claudeCommand, shellQuote } from "../../../shared/claude.ts";
import type { Session } from "../../../shared/types.ts";
import { act, api, getState, openInIde, openSession, setState, toast } from "../store.ts";
import type { SessionKey } from "./keys.ts";
import { native, popoutSession } from "./native.ts";

/** Control Room can type the answer: into tmux, or a VS Code terminal the helper reaches. */
export function reachable(s: Session): boolean {
  return s.vscodeLinked || !!s.tmux;
}

/** A question with one pick from a few options, which a click or a number key can answer. */
export function answerable(s: Session): boolean {
  const q = s.activity.question;
  return reachable(s) && s.activity.kind === "question" && !!q && q.count === 1 && !q.multiSelect && q.options.length > 0;
}

/** Why it can't go to your phone now, or null when it can. */
export function remoteBlocked(s: Session): string | null {
  const asking = s.activity.kind === "approval" || s.activity.kind === "question";
  return asking && !s.remoteUrl ? "Answer the session first, then send it to your phone" : null;
}

export function toPhone(s: Session): void {
  const why = remoteBlocked(s);
  if (why) return toast(why, "error");
  if (s.remoteUrl) void api("/api/open", { url: s.remoteUrl, pid: s.pid });
  else void act(`${s.pid}:remote`, `/api/sessions/${s.pid}/remote`);
}

export function showDetails(s: Session): void {
  setState(getState().snapshot?.settings.layout === "focus" ? { selected: s.pid } : { drawer: s.pid, selected: s.pid });
}

export function showInFinder(s: Session): void {
  void api("/api/open", { folder: s.git?.root ?? s.cwd });
}

/** To the front or the end of the list, where a drag would put it. */
export function moveTo(s: Session, where: "front" | "end"): void {
  const order = getState().snapshot?.sessions ?? [];
  const other = where === "front" ? order[0] : order.at(-1);
  if (!other || other.pid === s.pid) return;
  void act(`${s.pid}:place`, `/api/sessions/${s.pid}/place`, where === "front" ? { below: other.pid } : { above: other.pid }, true);
}

/** In a browser tab whose clipboard API refuses, the old copy command may still work. */
function copyByCommand(text: string): boolean {
  const box = document.createElement("textarea");
  box.value = text;
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.appendChild(box);
  box.select();
  const ok = document.execCommand("copy");
  box.remove();
  return ok;
}

function copy(text: string, what: string): void {
  void (native ? native.copyText(text) : navigator.clipboard.writeText(text))
    .then(
      () => true,
      () => copyByCommand(text),
    )
    .then((ok) => toast(ok ? `Copied ${what}` : `Couldn't copy ${what}`, ok ? "ok" : "error"));
}

export function copyResumeCommand(s: Session): void {
  copy(`cd ${shellQuote(s.cwd)} && ${claudeCommand(s.account)} --resume ${s.sessionId}`, "the resume command");
}

export function copySessionId(s: Session): void {
  copy(s.sessionId, "the session ID");
}

/** Renames where the name shows: in its details when they show, else on its tile. */
export function rename(s: Session): void {
  if (s.ide === "vscode" && !s.vscodeLinked) return toast("Renaming a VS Code session needs the VS Code helper (Settings)", "error");
  setState({ renaming: s.pid, selected: s.pid });
}

/** Does what the key stands for, to this session. False when it does not apply to it, so nothing happened. */
export function runSessionKey(k: SessionKey, s: Session): boolean {
  const a = s.activity;
  const claude = !s.terminal;
  switch (k.id) {
    case "open":
      openSession(s);
      return true;
    case "details": {
      // In Focus the details are always on show; elsewhere the key opens and closes them.
      const st = getState();
      if (st.snapshot?.settings.layout !== "focus" && st.drawer === s.pid) setState({ drawer: null });
      else showDetails(s);
      return true;
    }
    case "ide":
      void openInIde(s);
      return true;
    case "popout":
      popoutSession(s.pid);
      return true;
    case "rename":
      rename(s);
      return true;
    case "remote":
      if (claude) toPhone(s);
      return claude;
    case "finder":
      showInFinder(s);
      return true;
    case "moveFront":
    case "moveEnd":
      moveTo(s, k.id === "moveFront" ? "front" : "end");
      return true;
    case "copyResume":
      if (claude) copyResumeCommand(s);
      return claude;
    case "copyId":
      if (claude) copySessionId(s);
      return claude;
    case "approve":
    case "reject": {
      // One it can't reach still asks: the answer says why.
      if (a.kind !== "approval") return false;
      void act(`${s.pid}:${k.id}`, `/api/sessions/${s.pid}/${k.id}`);
      return true;
    }
    case "answer": {
      if (!answerable(s) || k.n > Math.min(4, a.question!.options.length)) return false;
      void act(`${s.pid}:answer`, `/api/sessions/${s.pid}/answer`, { option: k.n - 1 });
      return true;
    }
    case "pr":
      if (s.pr) void api("/api/open", { url: s.pr.url, pid: s.pid });
      return !!s.pr;
    case "close":
      setState({ closing: s.pid });
      return true;
  }
}
