import { Bell, BellOff, ChevronDown, ChevronUp, Settings, Volume2, VolumeX, X } from "lucide-react";
import { useState } from "react";
import type { Snapshot } from "../../../shared/types.ts";
import { playChime } from "../lib/alerts.ts";
import { native } from "../lib/native.ts";
import { act, api, remember, setState, useStore, VIEW } from "../store.ts";
import { IconButton } from "./Primitives.tsx";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <defs>
        <radialGradient id="lg" cx="50%" cy="45%" r="60%">
          <stop offset="0" stopColor="#5ff2d6" />
          <stop offset="1" stopColor="#1d6bff" />
        </radialGradient>
      </defs>
      <rect x="6" y="8" width="23" height="19" rx="5" fill="url(#lg)" />
      <rect x="35" y="8" width="23" height="19" rx="5" fill="#ffb547" />
      <rect x="6" y="33" width="23" height="19" rx="5" fill="#7aa2ff" opacity=".6" />
      <rect x="35" y="33" width="23" height="19" rx="5" fill="#7aa2ff" opacity=".3" />
    </svg>
  );
}

function PillToggle(props: { on: boolean; onIcon: React.ReactNode; offIcon: React.ReactNode; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className={`pill-toggle ${props.on ? "is-on" : ""}`}
      aria-pressed={props.on}
      data-tip={`${props.label}: ${props.on ? "on" : "off"}`}
      onClick={() => props.onChange(!props.on)}
    >
      {props.on ? props.onIcon : props.offIcon}
      <span>{props.label}</span>
      <span className="pill-state">{props.on ? "On" : "Off"}</span>
    </button>
  );
}

export function TopBar({ snap }: { snap: Snapshot | null }) {
  const connected = useStore((s) => s.connected);
  const collapsed = useStore((s) => s.overviewCollapsed);
  const cfg = snap?.settings;
  return (
    <header className={`topbar ${native ? "is-native" : ""}`}>
      <div className="brand">
        <Logo />
        <span className="brand-name">Control Room</span>
        <span className={`live ${connected ? "is-on" : ""}`} data-tip={connected ? "Live updates" : "Reconnecting…"}>
          <span className="live-dot" />
          {connected ? "Live" : "Offline"}
        </span>
      </div>
      <div className="topbar-tools">
        {cfg && !VIEW.wallOnly && (
          <>
            <PillToggle
              on={cfg.notifications}
              label="Notifications"
              onIcon={<Bell size={14} />}
              offIcon={<BellOff size={14} />}
              onChange={(on) => {
                if (on && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
                void api("/api/settings", { notifications: on });
              }}
            />
            <PillToggle
              on={cfg.sounds}
              label="Sounds"
              onIcon={<Volume2 size={14} />}
              offIcon={<VolumeX size={14} />}
              onChange={(on) => {
                if (on) playChime("done");
                void api("/api/settings", { sounds: on });
              }}
            />
          </>
        )}
        <IconButton
          label={collapsed ? "Show the overview" : "Hide the overview"}
          onClick={() => {
            setState({ overviewCollapsed: !collapsed });
            remember("cr.overviewCollapsed", !collapsed);
          }}
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </IconButton>
        <IconButton label="Settings" onClick={() => setState({ panel: "settings" })}>
          <Settings size={16} />
        </IconButton>
      </div>
    </header>
  );
}

export function SetupBanner({ snap }: { snap: Snapshot }) {
  const busy = useStore((s) => s.busy);
  const [hidden, setHidden] = useState(() => sessionStorage.getItem("cr.setupHidden") === "1");
  const needStatus = snap.setup.statusLine !== "installed" || !snap.setup.hooks;
  const needVscode = snap.setup.vscodeHelper === "missing" && snap.sessions.some((s) => s.ide === "vscode");
  if (hidden || VIEW.wallOnly || (!needStatus && !needVscode)) return null;
  return (
    <div className="setup-banner">
      <span className="setup-title">Finish setup</span>
      {needStatus && (
        <button type="button" className="setup-step" disabled={busy.statusline} onClick={() => void act("statusline", "/api/setup/statusline", { install: true })}>
          <b>Connect Claude Code</b>
          <span>for usage limits, model, effort and what each approval asks</span>
        </button>
      )}
      {needVscode && (
        <button type="button" className="setup-step" disabled={busy.vscode} onClick={() => void act("vscode", "/api/setup/vscode")}>
          <b>Install the VS Code helper</b>
          <span>to jump to a session and approve from here</span>
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label="Hide"
        onClick={() => {
          sessionStorage.setItem("cr.setupHidden", "1");
          setHidden(true);
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
