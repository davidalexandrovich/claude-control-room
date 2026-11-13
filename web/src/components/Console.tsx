// The live terminal of a session that runs in Control Room. What you type goes straight to Claude Code,
// the same as in a terminal tab: Esc, Ctrl+C, slash commands, arrows and pasting all work.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { AArrowDown, AArrowUp, ChevronDown, Maximize2, Minimize2, Minus, PictureInPicture2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { commandOf } from "../lib/keys.ts";
import { api, type ConsoleView, remember, stored } from "../store.ts";
import { PromptMenu } from "./Prompts.tsx";

const THEME = {
  background: "#0a0d13",
  foreground: "#e9edf4",
  cursor: "#7aa2ff",
  cursorAccent: "#0a0d13",
  selectionBackground: "rgba(122, 162, 255, 0.32)",
  black: "#1b1f27",
  red: "#ff6b6b",
  green: "#5be39a",
  yellow: "#ffb547",
  blue: "#7aa2ff",
  magenta: "#c4a5ff",
  cyan: "#3ee0c5",
  white: "#d5dae3",
  brightBlack: "#6c7588",
  brightRed: "#ff8a8a",
  brightGreen: "#7cf0b2",
  brightYellow: "#ffc978",
  brightBlue: "#9bb9ff",
  brightMagenta: "#d6bfff",
  brightCyan: "#6ff0da",
  brightWhite: "#ffffff",
};

const FONT = { min: 9, max: 24, default: 13 };

// A web address in plain text; the punctuation that usually ends a sentence is left out of it.
const URL_TEXT = /https?:\/\/[^\s"'<>`]*[^\s"'<>`.,;:!?)\]}]/g;

/**
 * Opens a link through the app, so the console's page itself never leaves the dashboard: in the Chrome profile of the
 * session's account when it has one, else in your default browser.
 */
function openLink(uri: string, from: { pid?: number; account?: string }): void {
  if (/^https?:\/\//i.test(uri)) void api("/api/open", { url: uri, ...from }).catch(() => null);
}

function bytes(base64: string): Uint8Array {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

interface Props {
  name: string;
  pid?: number; // the session it shows, whose account's Chrome profile its links open in
  account?: string; // before the session has a pid: the folder of its account, "" for the usual one
  autoFocus?: boolean;
  onFocused?: () => void;
  title?: string; // the session's name, for the bar when the rest of its details are out of sight
  view?: ConsoleView; // with onView: the bar gets window buttons
  onView?: (view: ConsoleView) => void;
  onPopOut?: () => void;
}

export default function Console({ name, pid, account, autoFocus = false, onFocused, title, view = "normal", onView, onPopOut }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const refit = useRef<() => void>(() => {});
  const [state, setState] = useState<"connecting" | "live" | "ended">("connecting");
  // One text size for every console, kept for next time.
  const [fontSize, setFontSize] = useState(() => stored("cr.consoleFont", FONT.default));
  const zoom = (by: number) => setFontSize((f) => Math.max(FONT.min, Math.min(FONT.max, f + by)));

  // Bigger text means fewer columns and rows in the same box, so the session gets the new size too.
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    remember("cr.consoleFont", fontSize);
    refit.current();
  }, [fontSize]);

  // Takes the keyboard only when asked, and only once: in the focus layout, keys 1 to 9 still pick a session.
  useEffect(() => {
    if (!autoFocus || state !== "live") return;
    termRef.current?.focus();
    onFocused?.();
  }, [autoFocus, state]);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize,
      lineHeight: 1.12,
      cursorBlink: true,
      scrollback: 5_000,
      theme: THEME,
      // Links Claude Code marks as links (OSC 8), such as a pull request or a file it wrote.
      linkHandler: { activate: (_e, uri) => openLink(uri, { pid, account }), allowNonHttpProtocols: false },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box.current!);
    termRef.current = term;
    const wanted = () => fit.proposeDimensions() ?? { cols: 100, rows: 30 };

    // And addresses that are only text, as a command prints them. A long one the terminal wrapped over several
    // rows is read as one line, so a click opens all of it. One that runs into the right edge may go on in the next
    // row, broken there by the program itself, so it gets no link: a click must never open half an address.
    term.registerLinkProvider({
      provideLinks(y, done) {
        const buf = term.buffer.active;
        let first = y - 1;
        while (first > 0 && buf.getLine(first)?.isWrapped) first--;
        let last = y - 1;
        while (buf.getLine(last + 1)?.isWrapped) last++;
        let text = "";
        for (let i = first; i <= last; i++) text += buf.getLine(i)?.translateToString(i === last) ?? "";
        const cols = term.cols;
        const at = (i: number) => ({ x: (i % cols) + 1, y: first + Math.floor(i / cols) + 1 });
        const links = [...text.matchAll(URL_TEXT)]
          .map((m) => ({ text: m[0], range: { start: at(m.index), end: at(m.index + m[0].length - 1) }, activate: () => openLink(m[0], { pid, account }) }))
          .filter((l) => l.range.start.y <= y && y <= l.range.end.y && l.range.end.x < cols - 3);
        done(links.length ? links : undefined);
      },
    });

    // tmux already answers what Claude Code asks the terminal (its type, the cursor position, the colors).
    // A second answer from here would reach Claude Code as typed text, so these questions go unanswered.
    const ignore = () => true;
    for (const id of [
      { final: "c" },
      { prefix: ">", final: "c" },
      { prefix: "=", final: "c" },
      { final: "n" },
      { prefix: "?", final: "n" },
      { intermediates: "$", final: "p" },
      { prefix: "?", intermediates: "$", final: "p" },
      { prefix: ">", final: "q" },
      { final: "t" },
      // The kitty keyboard protocol would change what keys send; tmux passes keys the classic way.
      { prefix: "?", final: "u" },
      { prefix: ">", final: "u" },
      { prefix: "<", final: "u" },
      { prefix: "=", final: "u" },
    ]) {
      term.parser.registerCsiHandler(id, ignore);
    }
    term.parser.registerDcsHandler({ intermediates: "$", final: "q" }, ignore);
    for (const osc of [4, 10, 11, 12]) term.parser.registerOscHandler(osc, ignore);

    // Keys go out in order, and whatever is typed while one request runs goes out with the next.
    let pending = "";
    let sending = false;
    const pump = async () => {
      if (sending || !pending) return;
      sending = true;
      const data = pending;
      pending = "";
      await api(`/api/console/${name}/input`, { data }).catch(() => null);
      sending = false;
      void pump();
    };
    const send = (data: string) => {
      pending += data;
      void pump();
    };
    term.onData(send);
    // The app's own shortcuts pass by the console to the app. Shift+Enter starts a new line in the prompt, the way
    // Option+Enter does in Claude Code.
    term.attachCustomKeyEventHandler((e) => {
      if (commandOf(e)) return false;
      if (e.key !== "Enter" || !e.shiftKey) return true;
      if (e.type === "keydown") send("\x1b\r");
      return false;
    });

    // One session has one size, whichever window set it last; this console follows it and asks for its own
    // only when its own box changes.
    const follow = (cols: number, rows: number) => {
      if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
    };
    let ended = false;
    let stream: EventSource | null = null;
    const connect = () => {
      const { cols, rows } = wanted();
      stream = new EventSource(`/api/console/${name}/stream?cols=${cols}&rows=${rows}`);
      stream.addEventListener("reset", (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as { data: string; x: number; y: number; cursor: boolean; cols: number; rows: number };
        term.reset();
        follow(d.cols, d.rows);
        term.write(bytes(d.data));
        // Claude Code turned bracketed paste on when it started, so a pasted block arrives as one message.
        term.write(`\x1b[${d.y + 1};${d.x + 1}H${d.cursor ? "\x1b[?25h" : "\x1b[?25l"}\x1b[?2004h`);
        setState("live");
      });
      stream.addEventListener("data", (ev) => term.write(bytes((ev as MessageEvent).data)));
      stream.addEventListener("size", (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as { cols: number; rows: number };
        follow(d.cols, d.rows);
      });
      stream.addEventListener("exit", () => {
        ended = true;
        setState("ended");
        stream?.close();
      });
      // A lost link: the browser connects again by itself, and the server paints the screen anew.
      stream.onerror = () => {
        if (!ended) setState("connecting");
      };
    };
    connect();

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    const sendSize = () => {
      if (!box.current?.offsetParent) return;
      const { cols, rows } = wanted();
      if (`${cols}x${rows}` === last) return;
      last = `${cols}x${rows}`;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => void api(`/api/console/${name}/resize`, { cols, rows }).catch(() => null), 120);
    };
    refit.current = sendSize;
    const observer = new ResizeObserver(sendSize);
    observer.observe(box.current!);

    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
      stream?.close();
      termRef.current = null;
      refit.current = () => {};
      term.dispose();
    };
  }, [name]);

  // Like a window's title bar: a double-click maximizes or restores, and a folded console opens with a click.
  const toggleMax = () => onView?.(view === "max" ? "normal" : "max");
  return (
    <div className={`console is-${state} is-view-${view}`} onClick={(e) => e.stopPropagation()}>
      <div
        className="console-bar"
        onDoubleClick={(e) => e.target === e.currentTarget && toggleMax()}
        onClick={(e) => view === "min" && e.target === e.currentTarget && onView?.("normal")}
      >
        <span className="console-title">
          {view !== "normal" && title}
          {view === "min" && <span className="muted"> · console minimized, click to show</span>}
        </span>
        {view !== "min" && state === "live" && (
          <div className="console-tools" aria-label="Prompts">
            {/* xterm wraps it as a paste, as Claude Code asked, so its new lines don't send it; you press Enter. */}
            <PromptMenu
              onPick={(text) => {
                termRef.current?.paste(text);
                termRef.current?.focus();
              }}
            />
          </div>
        )}
        {view !== "min" && (
          <div className="console-tools" aria-label="Text size">
            <button type="button" aria-label="Smaller text" data-tip="Smaller text" disabled={fontSize <= FONT.min} onClick={() => zoom(-1)}>
              <AArrowDown size={15} />
            </button>
            <button type="button" className="console-zoom-size" data-tip="Text size · click for the usual size" onClick={() => setFontSize(FONT.default)}>
              {fontSize}
            </button>
            <button type="button" aria-label="Bigger text" data-tip="Bigger text" disabled={fontSize >= FONT.max} onClick={() => zoom(1)}>
              <AArrowUp size={15} />
            </button>
          </div>
        )}
        {onView && (
          <div className="console-tools" aria-label="Console window">
            {view === "min" ? (
              <button type="button" aria-label="Show console" data-tip="Show the console" onClick={() => onView("normal")}>
                <ChevronDown size={15} />
              </button>
            ) : (
              <button type="button" aria-label="Minimize console" data-tip="Minimize: fold it to this bar" onClick={() => onView("min")}>
                <Minus size={15} />
              </button>
            )}
            <button
              type="button"
              aria-label={view === "max" ? "Restore console" : "Maximize console"}
              data-tip={view === "max" ? "Back to the details (Esc outside the console)" : "Fill the window (double-click the bar)"}
              onClick={toggleMax}
            >
              {view === "max" ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            {onPopOut && (
              <button type="button" aria-label="Pop out" data-tip="Pop out to its own window" onClick={onPopOut}>
                <PictureInPicture2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="console-term" ref={box} />
      {state === "connecting" && <div className="console-note">Connecting…</div>}
      {state === "ended" && <div className="console-note">This session has ended.</div>}
    </div>
  );
}
