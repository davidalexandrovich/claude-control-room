// Sample sessions for the demo and the README screenshots. Every name, path and number here is made up,
// but each status goes through the same rules as a live session (deriveActivity and verdictFor).
import type { ChatLine, Claim, ClosePlan, GitInfo, PullRequest, Session, Snapshot, Story, WorktreeReport } from "../shared/types.ts";
import { deriveActivity, type StatusFile } from "./activity.ts";
import { emptyState, modelName, type ToolUse } from "./transcript.ts";
import { verdictFor, type WorktreeFacts } from "./worktrees.ts";

const MIN = 60_000;
const CODE = "/Users/you/code";
const INACTIVE_AFTER = 120 * MIN;

type Status = "busy" | "permission" | "question" | "shell" | "done";

interface Seed {
  pid: number;
  name: string;
  repo: string;
  worktree?: string; // a linked worktree folder next to the main checkout
  branch: string;
  started: number; // minutes ago
  status: Status;
  since: number; // minutes ago
  tool?: [name: string, input: Record<string, unknown>]; // the call it runs or waits on
  headline: string;
  now: string;
  chat: [ChatLine["role"], string][];
  changes?: [dirty: number, insertions: number, deletions: number, ahead: number];
  pr?: Pick<PullRequest, "number" | "title" | "state" | "isDraft" | "review" | "checks"> & { checked?: [number, number, number] };
  story?: Pick<Story, "id" | "name" | "state">;
  claim?: string[]; // paths the session claimed in the repo's worktree registry
  remote?: boolean; // on Remote Control, so it is in the Claude app too
  model: string;
  effort: string;
  context: number;
  cost: number;
}

const QUESTION = {
  question: "Which colors should Settings use in dark mode?",
  header: "Colors",
  multiSelect: false,
  options: [
    { label: "Match the app", description: "Use the same dark colors as the rest of the app" },
    { label: "Follow macOS", description: "Switch between light and dark with the system" },
    { label: "Let me pick", description: "Show me three color sets first" },
  ],
};

// The first eight make the default demo; the last four join them on the big wall.
const SEEDS: Seed[] = [
  {
    pid: 48211,
    name: "Flaky checkout test",
    repo: "storefront",
    worktree: "storefront-checkout-flake",
    branch: "fix/checkout-flake",
    started: 26,
    status: "permission",
    since: 1,
    tool: ["Bash", { command: "npx playwright test checkout.spec.ts --repeat-each=20" }],
    headline: "Making the checkout test pass every time, not just most of the time.",
    now: "Found the cause: two tests shared one cart. Wants to run the test 20 times to prove the fix.",
    chat: [
      ["user", "The checkout test fails about one run in ten. Find out why and fix it."],
      ["tool", "Run a command: Repeat the checkout test 50 times"],
      ["assistant", "It failed 6 times out of 50. Every failure happens when two tests use the same test cart at the same moment."],
      ["tool", "Edit a file: tests/checkout.spec.ts"],
      ["assistant", "Each test now creates its own cart. Next I want to run the test 20 times in a row to prove it is stable."],
    ],
    changes: [2, 48, 12, 1],
    story: { id: 2481, name: "Checkout test fails 1 run in 10", state: "In Progress" },
    model: "claude-opus-5-5",
    effort: "high",
    context: 38,
    cost: 1.84,
  },
  {
    pid: 48077,
    name: "Dark mode for Settings",
    repo: "storefront",
    worktree: "storefront-dark-settings",
    branch: "feat/settings-dark-mode",
    started: 38,
    status: "question",
    since: 3,
    tool: ["AskUserQuestion", { questions: [QUESTION] }],
    headline: "Adding a dark theme to the Settings page.",
    now: "The theme works on every section. Asked you which colors to use.",
    chat: [
      ["user", "Add dark mode to the Settings page. Keep it simple."],
      ["tool", "Read a file: pages/Settings.tsx"],
      ["tool", "Edit a file: styles/theme.css"],
      ["assistant", "Dark mode works on all six Settings sections. One choice is yours: which colors should it use?"],
    ],
    changes: [5, 164, 22, 0],
    model: "claude-sonnet-5-5",
    effort: "medium",
    context: 22,
    cost: 0.41,
  },
  {
    pid: 47950,
    name: "Rate limit for the public API",
    repo: "payments-api",
    worktree: "payments-api-rate-limit",
    branch: "feat/rate-limit",
    started: 52,
    status: "busy",
    since: 12,
    tool: ["Edit", { file_path: `${CODE}/payments-api-rate-limit/src/middleware/rateLimit.ts` }],
    headline: "Stopping one customer from flooding the public API with requests.",
    now: "Writing the limit rules and their tests. 3 of 5 tests pass.",
    chat: [
      ["user", "Add a rate limit to the public API: 100 requests per minute for each key."],
      ["assistant", "Plan: a small middleware that counts requests per API key, then answers 429 with a Retry-After header."],
      ["tool", "Write a file: middleware/rateLimit.ts"],
      ["tool", "Run a command: Test the rate limiter"],
      ["assistant", "3 of 5 tests pass. The two failures are about the reset time. Fixing that now."],
    ],
    changes: [4, 162, 8, 3],
    pr: { number: 312, title: "Rate limit the public API", state: "OPEN", isDraft: false, review: "REVIEW_REQUIRED", checks: "pending", checked: [3, 0, 2] },
    story: { id: 2502, name: "Limit requests on public endpoints", state: "In Progress" },
    claim: ["src/middleware/", "tests/rateLimit.test.ts"],
    remote: true,
    model: "claude-opus-5-5",
    effort: "xhigh",
    context: 61,
    cost: 3.92,
  },
  {
    pid: 47888,
    name: "Upgrade to React 19",
    repo: "admin-dashboard",
    branch: "chore/react-19",
    started: 94,
    status: "busy",
    since: 41,
    tool: ["Bash", { command: "npm run build && npm test", description: "Build the app and run all tests" }],
    headline: "Moving the admin dashboard to React 19.",
    now: "The app builds. Two tests still fail, and it is fixing them.",
    chat: [
      ["user", "Upgrade the admin dashboard to React 19 and fix whatever breaks."],
      ["tool", "Run a command: Update react and react-dom"],
      ["assistant", "Updated 4 packages. 11 files used an old API, and I changed them."],
      ["tool", "Run a command: Build the app and run all tests"],
    ],
    changes: [23, 480, 512, 2],
    pr: { number: 88, title: "Upgrade to React 19", state: "OPEN", isDraft: true, review: null, checks: "failing", checked: [12, 2, 0] },
    model: "claude-opus-5-5",
    effort: "high",
    context: 74,
    cost: 6.1,
  },
  {
    pid: 47702,
    name: "Release notes for v2.4",
    repo: "docs",
    branch: "docs/release-2-4",
    started: 110,
    status: "done",
    since: 9,
    headline: "Writing the release notes for version 2.4 in plain words.",
    now: "The draft is ready in CHANGELOG.md, with 3 new features and 9 fixes.",
    chat: [
      ["user", "Write the release notes for v2.4 from the merged PRs. Plain words, no jargon."],
      ["tool", "Run a command: List the PRs merged since v2.3"],
      ["assistant", "The draft is in CHANGELOG.md: 3 new features and 9 fixes, each in one plain sentence."],
    ],
    changes: [1, 96, 0, 0],
    model: "claude-sonnet-5-5",
    effort: "low",
    context: 18,
    cost: 0.22,
  },
  {
    pid: 47540,
    name: "Nightly data export",
    repo: "data-pipeline",
    branch: "perf/nightly-export",
    started: 140,
    status: "shell",
    since: 18,
    headline: "Making the nightly export finish in under one hour.",
    now: "A full test export runs in the background. It takes about 25 minutes.",
    chat: [
      ["user", "The nightly export takes 3 hours. Make it faster."],
      ["assistant", "The slow part is one query that reads every order. I split it into daily batches that run side by side."],
      ["tool", "Run a command: Start a full test export"],
      ["assistant", "The test export runs in the background. I will check the time when it ends."],
    ],
    changes: [2, 64, 30, 1],
    model: "claude-opus-5-5",
    effort: "high",
    context: 47,
    cost: 2.75,
  },
  {
    pid: 47311,
    name: "Faster search results",
    repo: "storefront",
    worktree: "storefront-search-speed",
    branch: "perf/search-results",
    started: 185,
    status: "done",
    since: 6,
    headline: "Making the search page load faster.",
    now: "Done. The page loads in 0.8 s instead of 2.1 s, and the PR is approved.",
    chat: [
      ["user", "Search feels slow. Find out why and make it faster."],
      ["assistant", "Each search asked the database the same question again. I added a 60-second cache."],
      ["tool", "Run a command: Measure the page load time"],
      ["assistant", "Done. The search page loads in 0.8 s instead of 2.1 s. PR #1290 is approved, and all checks pass."],
    ],
    pr: { number: 1290, title: "Cache search results for 60 seconds", state: "OPEN", isDraft: false, review: "APPROVED", checks: "passing", checked: [14, 0, 0] },
    story: { id: 2467, name: "Search page is slow on phones", state: "In Review" },
    model: "claude-opus-5-5",
    effort: "medium",
    context: 33,
    cost: 1.12,
  },
  {
    pid: 46980,
    name: "Welcome email",
    repo: "marketing-site",
    worktree: "marketing-site-welcome-email",
    branch: "copy/welcome-email",
    started: 3060,
    status: "done",
    since: 2900,
    headline: "Rewriting the welcome email so new users know what to do first.",
    now: "Merged. New users get the new email from tomorrow.",
    chat: [
      ["user", "Rewrite the welcome email. Shorter, friendlier, and one clear first step."],
      ["assistant", "The new version has 90 words instead of 240, and one button: Create your first project."],
      ["assistant", "PR #57 is merged. New users get the new email from tomorrow."],
    ],
    pr: { number: 57, title: "New welcome email", state: "MERGED", isDraft: false, review: "APPROVED", checks: "passing", checked: [6, 0, 0] },
    claim: ["emails/welcome/", "docs/emails.md"],
    model: "claude-haiku-5-5",
    effort: "low",
    context: 12,
    cost: 0.08,
  },
  {
    pid: 48302,
    name: "Memory leak in the worker",
    repo: "payments-api",
    branch: "fix/worker-memory",
    started: 9,
    status: "busy",
    since: 3,
    tool: ["Grep", { pattern: "setInterval" }],
    headline: "Finding why the background worker uses more memory every hour.",
    now: "Looking for timers that never stop.",
    chat: [
      ["user", "The worker grows by about 200 MB an hour. Find the leak."],
      ["assistant", "Memory grows only while jobs retry. I am looking for timers that never stop."],
    ],
    model: "claude-opus-5-5",
    effort: "high",
    context: 9,
    cost: 0.31,
  },
  {
    pid: 47990,
    name: "Move to Postgres 17",
    repo: "data-pipeline",
    branch: "chore/postgres-17",
    started: 47,
    status: "permission",
    since: 2,
    tool: ["ExitPlanMode", {}],
    headline: "Planning the move of the main database to Postgres 17.",
    now: "The plan has 6 steps and a way back at each step.",
    chat: [
      ["user", "Plan how we move the main database to Postgres 17 with no downtime."],
      ["assistant", "Here is the plan: 6 steps, each with a check and a way back. Nothing runs until you approve it."],
    ],
    model: "claude-opus-5-5",
    effort: "max",
    context: 29,
    cost: 1.47,
  },
  {
    pid: 47620,
    name: "Spanish translation",
    repo: "mobile-app",
    branch: "feat/spanish",
    started: 70,
    status: "busy",
    since: 26,
    tool: ["Write", { file_path: `${CODE}/mobile-app/locales/es.json` }],
    headline: "Translating the mobile app into Spanish.",
    now: "412 of 530 phrases are done.",
    chat: [
      ["user", "Translate the app into Spanish. Keep the tone friendly and short."],
      ["assistant", "412 of 530 phrases are done. I keep button labels under 14 letters so they fit."],
    ],
    changes: [3, 412, 0, 0],
    model: "claude-sonnet-5-5",
    effort: "medium",
    context: 52,
    cost: 0.96,
  },
  {
    pid: 47130,
    name: "CSV export for orders",
    repo: "admin-dashboard",
    worktree: "admin-dashboard-orders-csv",
    branch: "feat/orders-csv",
    started: 230,
    status: "done",
    since: 22,
    headline: "Letting the team download orders as a CSV file.",
    now: "Done and tested with 10,000 orders. Asked if it should add an Excel option too.",
    chat: [
      ["user", "Add a button that downloads the filtered orders as CSV."],
      ["assistant", "Done. It handles 10,000 orders in under a second, and PR #91 waits for a review. Should I also add an Excel option?"],
    ],
    pr: { number: 91, title: "Export orders as CSV", state: "OPEN", isDraft: false, review: "REVIEW_REQUIRED", checks: "passing", checked: [9, 0, 0] },
    model: "claude-opus-5-5",
    effort: "medium",
    context: 41,
    cost: 0.88,
  },
];

export const DEMO_DEFAULT_COUNT = 8;
export const DEMO_MAX_COUNT = SEEDS.length;

const STATUS_FILE: Record<Status, [string | null, string | null]> = {
  busy: ["busy", null],
  permission: ["waiting", "permission prompt"],
  question: ["waiting", "input needed"],
  shell: ["shell", null],
  done: [null, null],
};

function gitOf(s: Seed): GitInfo {
  const [dirty, insertions, deletions, ahead] = s.changes ?? [0, 0, 0, 0];
  return {
    root: `${CODE}/${s.worktree ?? s.repo}`,
    mainRoot: `${CODE}/${s.repo}`,
    isWorktree: !!s.worktree,
    branch: s.branch,
    dirty,
    insertions,
    deletions,
    ahead,
    behind: 0,
    upstream: `origin/${s.branch}`,
    remote: { owner: "acme", name: s.repo },
  };
}

function prOf(s: Seed, now: number): PullRequest | null {
  if (!s.pr) return null;
  const [passed, failed, pending] = s.pr.checked ?? [0, 0, 0];
  const { checked: _checked, ...pr } = s.pr;
  return {
    ...pr,
    url: `https://github.com/acme/${s.repo}/pull/${pr.number}`,
    checksSummary: { passed, failed, pending },
    mergeable: "MERGEABLE",
    updatedAt: new Date(now - s.since * MIN).toISOString(),
    mergedAt: pr.state === "MERGED" ? new Date(now - s.since * MIN).toISOString() : null,
  };
}

function sessionOf(s: Seed, now: number): Session {
  const startedAt = now - s.started * MIN;
  const since = now - s.since * MIN;
  const chat: ChatLine[] = s.chat.map(([role, text], i) => ({ role, text, at: new Date(startedAt + (i + 1) * 2 * MIN).toISOString() }));
  const pending: ToolUse[] = s.tool ? [{ id: `demo-${s.pid}`, name: s.tool[0], input: s.tool[1], at: null }] : [];
  const transcript = {
    ...emptyState(""),
    chat,
    pending,
    lastAssistantText: [...chat].reverse().find((c) => c.role === "assistant")?.text ?? null,
  };
  const [status, waitingFor] = STATUS_FILE[s.status];
  const file: StatusFile = { status, waitingFor, statusUpdatedAt: since, updatedAt: since, startedAt };
  const git = gitOf(s);
  const claims: Claim[] = s.claim
    ? [{ repo: git.mainRoot, worktree: git.root, branch: s.branch, note: s.name, paths: s.claim, leases: [], live: true }]
    : [];
  return {
    pid: s.pid,
    shellPid: s.pid - 7,
    sessionId: `0000demo-0000-4000-8000-0000000${s.pid}`,
    name: s.name,
    nameSource: "title",
    shortName: `${s.repo}-${(s.pid % 256).toString(16)}`,
    cwd: git.root,
    startedAt,
    lastActivityAt: s.status === "busy" ? now : since,
    activity: deriveActivity(file, transcript, now, INACTIVE_AFTER),
    summary: { headline: s.headline, now: s.now, source: "ai", updatedAt: since },
    firstPrompt: chat[0]?.text ?? null,
    chat,
    git,
    pr: prOf(s, now),
    story: s.story ? { ...s.story, url: `https://app.shortcut.com/acme/story/${s.story.id}`, type: "feature", owners: ["you"] } : null,
    storyId: s.story?.id ?? null,
    claims,
    model: modelName(s.model),
    effort: s.effort,
    effortIsDefault: false,
    contextPercent: s.context,
    costUsd: s.cost,
    repoName: s.repo,
    where: "vscode",
    vscodeLinked: true,
    transcriptPath: null,
    tmux: null,
    remoteUrl: s.remote ? `https://claude.ai/code/session_demo${s.pid}` : null,
  };
}

/** A whole dashboard's worth of sample data, with every time counted back from `now`. */
export function demoSnapshot(now: number, count = DEMO_DEFAULT_COUNT): Snapshot {
  const sessions = SEEDS.slice(0, Math.max(1, Math.min(count, SEEDS.length)))
    .map((s) => sessionOf(s, now))
    .sort((a, b) => b.startedAt - a.startedAt);
  return {
    at: now,
    sessions,
    usage: {
      fiveHour: { usedPercent: 42, resetsAt: now + 134 * MIN },
      sevenDay: { usedPercent: 61, resetsAt: now + 77 * 60 * MIN },
      observedAt: now,
    },
    account: { email: "you@example.com", orgName: "Acme", plan: "max", loggedIn: true },
    power: { sleepDisabled: true, passwordless: false },
    setup: { statusLine: "installed", hooks: true, vscodeHelper: "connected", vscodeWindows: 3, ghReady: true, shortcutReady: true },
    settings: {
      notifications: true,
      sounds: true,
      aiSummaries: true,
      inactiveAfterMinutes: INACTIVE_AFTER / MIN,
      includeIdePanel: false,
      layout: "fit",
      shortcutTokens: ["••••8c2f"],
    },
  };
}

interface ReportOpts {
  isMain?: boolean;
  exists?: boolean;
  live?: number[];
  daysAgo?: number;
}

function report(now: number, repo: string, path: string, branch: string | null, facts: WorktreeFacts | null, pr: { number: number; state: string } | null, opts: ReportOpts = {}): WorktreeReport {
  const live = opts.live ?? [];
  const { verdict, reason } = verdictFor({ isMain: !!opts.isMain, exists: opts.exists ?? true, liveSessions: live.length, facts, pr });
  return {
    path,
    branch,
    verdict,
    reason,
    dirty: facts?.dirty ?? 0,
    unpushed: facts?.unpushed ?? 0,
    unpushedKnown: facts?.unpushedKnown ?? false,
    pr: pr ? { ...pr, url: `https://github.com/acme/${repo}/pull/${pr.number}` } : null,
    liveSessions: live,
    claim: null,
    lastCommitAt: new Date(now - (opts.daysAgo ?? 1) * 24 * 60 * MIN).toISOString(),
  };
}

const facts = (dirty = 0, unpushed = 0): WorktreeFacts => ({ dirty, unpushed, unpushedKnown: true, headInPr: true, lastCommitAt: null });

/** The worktree cleanup list for one repo: the live sessions' folders, plus a few finished ones. */
export function demoWorktrees(repo: string, sessions: Session[], now: number): WorktreeReport[] {
  const name = repo.split("/").pop() ?? repo;
  const out: WorktreeReport[] = [report(now, name, repo, "main", null, null, { isMain: true })];
  for (const s of sessions) {
    if (s.git?.mainRoot === repo && s.git.isWorktree) out.push(report(now, name, s.git.root, s.git.branch, facts(s.git.dirty), null, { live: [s.pid], daysAgo: 0 }));
  }
  const extra: [string, string, WorktreeFacts | null, { number: number; state: string } | null, ReportOpts][] = [
    ["gift-cards", "feat/gift-cards", facts(), { number: 1271, state: "MERGED" }, { daysAgo: 4 }],
    ["promo-banner", "feat/promo-banner", facts(), { number: 1265, state: "MERGED" }, { daysAgo: 6 }],
    ["checkout-copy", "copy/checkout", facts(), { number: 1277, state: "MERGED" }, { daysAgo: 3 }],
    ["sitemap", "seo/sitemap", facts(), { number: 1262, state: "MERGED" }, { daysAgo: 8 }],
    ["cart-cleanup", "chore/cart-cleanup", facts(), { number: 1240, state: "MERGED" }, { daysAgo: 12 }],
    ["a11y-audit", "fix/a11y-audit", facts(), { number: 1258, state: "CLOSED" }, { daysAgo: 9 }],
    ["graphql-spike", "spike/graphql", facts(), null, { daysAgo: 15 }],
    ["tax-rules", "feat/tax-rules", facts(4), null, { daysAgo: 2 }],
    ["image-cdn", "perf/image-cdn", facts(0, 2), null, { daysAgo: 3 }],
    ["reviews", "feat/reviews", null, null, { exists: false, daysAgo: 20 }],
  ];
  for (const [folder, branch, f, pr, opts] of extra) out.push(report(now, name, `${CODE}/${name}-${folder}`, branch, f, pr, opts));
  return out;
}

/** What closing a session would do: the same advice the live app gives, from the sample facts. */
export function demoClosePlan(s: Session, sessions: Session[], now: number): ClosePlan {
  const g = s.git;
  if (!g?.isWorktree) return { pid: s.pid, claims: s.claims, worktree: null };
  const others = sessions.filter((o) => o.pid !== s.pid && o.cwd === g.root).map((o) => o.pid);
  const pr = s.pr ? { number: s.pr.number, state: s.pr.state } : null;
  return { pid: s.pid, claims: s.claims, worktree: report(now, s.repoName, g.root, g.branch, facts(g.dirty, g.ahead), pr, { live: others, daysAgo: 0 }) };
}
