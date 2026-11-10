import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Account, AccountRef } from "../shared/types.ts";
import { chromeProfiles, profileOf } from "./chrome.ts";
import { claudeEnv, type Home, homeDir, homes } from "./homes.ts";
import { settings } from "./config.ts";
import { connectLikeUsual, writeLinkScript } from "./statusline.ts";
import { APP_DIR, HOME } from "./paths.ts";
import { launch, run, sleep } from "./proc.ts";

const NONE: Account = { email: null, orgName: null, plan: null, loggedIn: false };
// By config folder; "" is ~/.claude, the usual one.
const accounts = new Map<string, Account>();
const logins = new Map<string, { startedAt: number; url: string | null; done: boolean }>();

export function currentAccount(dir: string | null = null): Account {
  return accounts.get(dir ?? "") ?? NONE;
}

export async function readAccount(ref: AccountRef | null = null): Promise<Account> {
  const out = await run("claude", ["auth", "status", "--json"], { timeoutMs: 20_000, env: claudeEnv(ref) });
  try {
    const d = JSON.parse(out.stdout);
    accounts.set(ref?.dir ?? "", {
      email: d.email ?? null,
      orgName: d.orgName ?? null,
      plan: d.subscriptionType ?? null,
      loggedIn: d.loggedIn === true,
    });
  } catch {
    /* keep the last known account */
  }
  // A sign-in may have changed whose account this is, so its links follow at once.
  await refreshLinkScript({ account: ref, dir: homeDir(ref) }, await chromeProfiles());
  return currentAccount(ref?.dir);
}

/** The usual account and every one in Settings. */
export async function readAccounts(): Promise<void> {
  await Promise.all([readAccount(null), ...settings().accounts.map((a) => readAccount(a))]);
}

/**
 * Points an account's link script at the Chrome profile signed in to its email. Chrome's file unread this time leaves
 * the script as it is: a passing read error must not send every link to the default browser.
 */
async function refreshLinkScript(h: Home, profiles: Map<string, string> | null): Promise<void> {
  if (!profiles) return;
  await writeLinkScript(h, profileOf(profiles, currentAccount(h.account?.dir).email)).catch(() => {});
}

export async function refreshLinkScripts(): Promise<void> {
  const profiles = await chromeProfiles();
  await Promise.all(homes().map((h) => refreshLinkScript(h, profiles)));
}

/** The sign-in link, if the text holds one of claude.ai's, without what may surround it. */
export function signInUrl(text: string): string | null {
  return /https:\/\/(?:claude\.com|claude\.ai|console\.anthropic\.com)\/[^\s\x1b\x07]+/.exec(text)?.[0] ?? null;
}

// `claude auth login` runs $BROWSER with its link. This one hands the link to Control Room instead, through a file, so
// it opens in a private window. It is the link whose sign-in comes back to the CLI by itself; the one the CLI prints
// asks you to paste a code into it.
const BROWSER_SCRIPT = join(APP_DIR, "signin-browser.sh");
export const BROWSER_BODY = `#!/bin/sh
# Control Room (installed by the app): hands the sign-in link of claude auth login to the app, for a private window.
printf '%s\\n' "$1" > "$CONTROL_ROOM_SIGNIN"
`;

async function linkFile(): Promise<string> {
  await mkdir(APP_DIR, { recursive: true });
  if ((await readFile(BROWSER_SCRIPT, "utf8").catch(() => null)) !== BROWSER_BODY) await writeFile(BROWSER_SCRIPT, BROWSER_BODY);
  await chmod(BROWSER_SCRIPT, 0o755);
  return join(APP_DIR, `signin-${randomBytes(4).toString("hex")}.url`);
}

async function waitForLink(file: string, ms: number): Promise<string | null> {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(200)) {
    const text = await readFile(file, "utf8").catch(() => null);
    if (text) {
      await unlink(file).catch(() => {});
      return signInUrl(text);
    }
  }
  await unlink(file).catch(() => {});
  return null;
}

// Browsers that open a private window from the command line, the first one this Mac has. A private window shares no
// cookies, so signing in there leaves the browser's own claude.ai signed in as it was: to your work account, say.
const PRIVATE: { app: string; flag: string }[] = [
  { app: "Google Chrome", flag: "--incognito" },
  { app: "Brave Browser", flag: "--incognito" },
  { app: "Microsoft Edge", flag: "--inprivate" },
  { app: "Firefox", flag: "--private-window" },
  { app: "Chromium", flag: "--incognito" },
];

/** Opens the link in a private window, and names the browser; null when none here can, and it opened as usual. */
async function openPrivately(url: string): Promise<string | null> {
  for (const b of PRIVATE) {
    if (![join("/Applications", `${b.app}.app`), join(HOME, "Applications", `${b.app}.app`)].some((p) => existsSync(p))) continue;
    if ((await run("open", ["-na", b.app, "--args", b.flag, url], { timeoutMs: 10_000 })).ok) return b.app;
  }
  launch("open", [url]);
  return null;
}

function signInMessage(where: string | null, which: string): string {
  return where
    ? `Sign in${which} in the private ${where} window that opened. Your browser's own claude.ai stays signed in as it is.`
    : `Sign in${which} in your browser. It signs your browser's claude.ai in to that account too; a private window would not.`;
}

/**
 * Starts `claude auth login`, which signs in on claude.ai in a browser: in a private window, opened here. For the usual
 * account, every session uses the new one once the sign-in finishes; another account signs in within its own folder.
 */
export async function startAccountSwitch(ref: AccountRef | null = null): Promise<{ ok: boolean; message: string; url: string | null }> {
  const key = ref?.dir ?? "";
  const login = logins.get(key);
  if (login && !login.done && Date.now() - login.startedAt < 10 * 60_000) {
    if (!login.url) return { ok: true, message: "A sign-in is starting.", url: null };
    return { ok: true, message: `A sign-in is open already. ${signInMessage(await openPrivately(login.url), "")}`, url: login.url };
  }
  const state = { startedAt: Date.now(), url: null as string | null, done: false };
  logins.set(key, state);
  const file = await linkFile();
  const child = spawn("claude", ["auth", "login", "--claudeai"], {
    env: { ...claudeEnv(ref), BROWSER: BROWSER_SCRIPT, CONTROL_ROOM_SIGNIN: file },
    stdio: "ignore",
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 10 * 60_000);
  const which = ref ? ` to ${ref.label}` : "";
  return new Promise((resolve) => {
    let answered = false;
    const answer = (ok: boolean, message: string) => {
      if (answered) return;
      answered = true;
      resolve({ ok, message, url: state.url });
    };
    child.on("error", (err) => answer(false, `Could not start the sign-in: ${err.message}`));
    child.on("exit", (code) => {
      clearTimeout(timer);
      state.done = true;
      void readAccount(ref);
      if (code === 0 && ref) void connectLikeUsual({ account: ref, dir: ref.dir });
      answer(code === 0, code === 0 ? `Signed in${which}.` : "The sign-in did not finish.");
    });
    void waitForLink(file, 15_000).then(async (url) => {
      if (!url) {
        child.kill("SIGTERM");
        return answer(false, "Claude Code gave no sign-in link. Run claude auth login in a terminal to see why.");
      }
      state.url = url;
      answer(true, signInMessage(await openPrivately(url), which));
    });
  });
}
