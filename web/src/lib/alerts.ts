import type { Session, Snapshot } from "../../../shared/types.ts";
import { getState, isShell, setState } from "../store.ts";
import { native } from "./native.ts";

let audio: AudioContext | null = null;

function bell(ctx: AudioContext, freq: number, at: number, length: number, gain: number): void {
  // A sine with a quiet octave above it reads as a soft bell rather than a beep.
  for (const [mult, level] of [
    [1, gain],
    [2, gain * 0.18],
  ] as const) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(level, at + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(amp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}

export type Chime = "attention" | "done";

export function playChime(kind: Chime): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const t = audio.currentTime + 0.03;
    if (kind === "attention") {
      bell(audio, 659.25, t, 0.45, 0.16);
      bell(audio, 987.77, t + 0.16, 0.7, 0.14);
    } else {
      bell(audio, 783.99, t, 0.4, 0.1);
      bell(audio, 523.25, t + 0.13, 0.75, 0.1);
    }
  } catch {
    /* no audio device */
  }
}

/** Browsers only start audio after a click; this unlocks it on the first one. */
export function unlockAudioOnce(): void {
  const unlock = () => {
    audio ??= new AudioContext();
    void audio.resume();
    window.removeEventListener("pointerdown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
}

function showNotification(title: string, body: string, pid: number): void {
  if (typeof Notification === "undefined") return;
  const fire = () => {
    const n = new Notification(title, { body, silent: true, tag: `cr-${pid}` });
    n.onclick = () => {
      native?.focusWindow();
      window.focus();
      setState({ drawer: pid, selected: pid });
    };
  };
  if (Notification.permission === "granted") fire();
  else if (Notification.permission !== "denied") void Notification.requestPermission().then((p) => p === "granted" && fire());
}

const workingSince = new Map<string, number>();

/** Compares two snapshots and raises a desktop notice and a chime for what changed. */
export function alertOnChange(prev: Snapshot | null, next: Snapshot): void {
  const cfg = next.settings;
  const before = new Map((prev?.sessions ?? []).map((s) => [s.sessionId, s]));
  let chime: Chime | null = null;
  for (const s of next.sessions) {
    if (isShell(s)) continue; // a command that ends in a terminal is no news; an agent that finishes is
    const old = before.get(s.sessionId);
    if (s.activity.kind === "working" && !workingSince.has(s.sessionId)) workingSince.set(s.sessionId, s.activity.since);
    if (!prev || !old || old.activity.kind === s.activity.kind) continue;
    const event = describe(old, s);
    if (s.activity.kind !== "working") workingSince.delete(s.sessionId);
    if (!event) continue;
    if (cfg.notifications && (event.chime === "attention" || !document.hasFocus())) showNotification(event.title, event.body, s.pid);
    if (event.chime === "attention" || chime === null) chime = event.chime;
  }
  if (chime && cfg.sounds) playChime(chime);
  const waiting = next.sessions.filter((s) => ["approval", "question", "waiting"].includes(s.activity.kind));
  native?.setBadge(waiting.length, waiting.map((s) => ({ pid: s.pid, name: s.name, label: s.activity.label })));
  if (getState().selected !== null && !next.sessions.some((s) => s.pid === getState().selected)) setState({ selected: null });
}

function describe(old: Session, s: Session): { title: string; body: string; chime: Chime } | null {
  const k = s.activity.kind;
  if (k === "approval") return { title: `${s.name} needs your approval`, body: s.activity.detail ?? "A tool wants to run", chime: "attention" };
  if (k === "question") return { title: `${s.name} asked you a question`, body: s.activity.detail ?? "", chime: "attention" };
  if (k === "waiting") return { title: `${s.name} is waiting for you`, body: s.activity.detail ?? "", chime: "attention" };
  if (old.activity.kind === "working" && (k === "idle" || k === "background")) {
    const started = workingSince.get(s.sessionId) ?? old.activity.since;
    if (Date.now() - started < 15_000) return null;
    // Its screen stood still: done, or asking to run something. Only its console can tell.
    if (s.agent) return { title: `${s.name} stopped`, body: "Check its console: it may be done, or asking you something.", chime: "attention" };
    const asked = s.activity.askedYou;
    const last = [...s.chat].reverse().find((c) => c.role === "assistant")?.text ?? "";
    return {
      title: asked ? `${s.name} is waiting for your reply` : `${s.name} finished`,
      body: (s.summary.now ?? last).slice(0, 180),
      chime: asked ? "attention" : "done",
    };
  }
  return null;
}
