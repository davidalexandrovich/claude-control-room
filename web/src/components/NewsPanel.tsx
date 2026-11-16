// The daily AI news: five picks for building with Claude, agents and dev tools, which Claude finds on the web once a day
// (server/news.ts). The button sits next to Live; a dot on it means a day's picks you haven't opened yet.
import { ArrowUpRight, Newspaper, RefreshCw, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { localDate, sourceOf } from "../../../shared/news.ts";
import type { Snapshot } from "../../../shared/types.ts";
import { act, remember, setState, useStore } from "../store.ts";
import { openUrl } from "./Monitor.tsx";
import { Spinner } from "./Primitives.tsx";

function dayName(date: string): string {
  if (date === localDate(Date.now())) return "Today";
  return new Date(`${date}T12:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export function NewsButton({ snap }: { snap: Snapshot }) {
  const seen = useStore((s) => s.newsSeen);
  const { issue, running } = snap.news;
  const fresh = !!issue && issue.date !== seen;
  const tip = issue
    ? `${dayName(issue.date)}'s ${issue.items.length} picks for Claude, agents and dev tools`
    : snap.settings.news
      ? running
        ? "Reading today's AI news…"
        : "Today's AI news"
      : "Daily AI news for Claude, agents and dev tools";
  return (
    <button type="button" className={`news-btn ${fresh ? "is-fresh" : ""}`} data-tip={tip} onClick={() => setState({ panel: "news" })}>
      {running && !issue ? <Spinner /> : <Newspaper size={12} />}
      AI news
      {fresh && <span className="news-dot" aria-label="New" />}
    </button>
  );
}

export function NewsPanel({ snap }: { snap: Snapshot }) {
  const close = () => setState({ panel: null });
  const { issue, running, error } = snap.news;
  const cfg = snap.settings;
  const busy = useStore((s) => !!s.busy.news);
  const accounts = [{ dir: "", label: cfg.defaultAccountLabel }, ...cfg.accounts];
  // Opened: the dot on the button goes until the next day's picks.
  useEffect(() => {
    if (!issue) return;
    setState({ newsSeen: issue.date });
    remember("cr.newsSeen", issue.date);
  }, [issue?.date]);
  const setNews = (patch: { news?: boolean; newsAccount?: string }) => void act("news", "/api/settings", patch, true);
  const accountPicker = (
    <select className="select news-account" aria-label="Runs on" value={cfg.newsAccount} onChange={(e) => setNews({ newsAccount: e.target.value })}>
      {accounts.map((a) => (
        <option key={a.dir} value={a.dir}>
          {a.label}
        </option>
      ))}
    </select>
  );
  return (
    <div className="scrim" onClick={close}>
      <motion.div
        className="sheet sheet-narrow news-sheet"
        role="dialog"
        aria-modal
        aria-label="AI news"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h2>
              <Newspaper size={17} /> AI news{issue ? ` · ${dayName(issue.date)}` : ""}
            </h2>
            <p className="dialog-sub">The most useful new things for building with Claude, agents and dev tools, picked from the web once a day.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="set-body news-body">
          {!cfg.news && (
            <div className="news-note">
              <p>
                Once a day, Claude searches the web for what came out in the last two days, and picks five. It runs on the account you pick, and uses a
                little of its usage. It gets web search only: no files, no shell, no MCP servers.
              </p>
              <div className="news-note-row">
                <span>Runs on</span>
                {accountPicker}
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setNews({ news: true })}>
                  Turn on
                </button>
              </div>
            </div>
          )}
          {cfg.news && !issue && running && (
            <div className="news-note news-wait">
              <Spinner /> Claude is reading today's AI news. It takes a few minutes.
            </div>
          )}
          {error && <p className="news-error tone-bad">{error}</p>}
          {issue && (
            <ol className="news-list">
              {issue.items.map((it, i) => (
                <li key={it.url}>
                  <button type="button" className="news-item" data-tip={it.url} onClick={() => openUrl(it.url, { account: cfg.newsAccount })}>
                    <span className="news-num">{i + 1}</span>
                    <span className="news-text">
                      <span className="news-title">{it.title}</span>
                      <span className="news-summary">{it.summary}</span>
                      <span className="news-meta">
                        {it.tag && <span className="news-tag">{it.tag}</span>}
                        {sourceOf(it.url)}
                        <ArrowUpRight size={12} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
        {cfg.news && (
          <div className="news-foot">
            <span className="news-when">
              {running ? "Reading the web now…" : issue ? `Picked at ${new Date(issue.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "None yet"} ·
              runs daily on
            </span>
            {accountPicker}
            <button type="button" className="btn btn-sm btn-ghost" disabled={running} onClick={() => void act("news-refresh", "/api/news/refresh", {}, true)}>
              {running ? <Spinner /> : <RefreshCw size={13} />} Pick again
            </button>
            <button type="button" className="btn btn-sm btn-ghost news-off" disabled={busy} onClick={() => setNews({ news: false })}>
              Turn off
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
