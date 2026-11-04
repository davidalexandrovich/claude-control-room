// Types shared by the server and the web UI. The server produces every value; the UI only reads.

export type StatusKind =
  | "working" // Claude is running a turn
  | "approval" // a permission prompt waits for you
  | "question" // Claude asked you a question (AskUserQuestion or an elicitation)
  | "waiting" // waiting for you for another reason (a dialog is open)
  | "background" // turn finished, a background command still runs
  | "idle" // turn finished recently
  | "inactive"; // nothing happened for a long time

export interface ToolPreview {
  tool: string; // raw tool name, e.g. "Bash"
  action: string; // plain words, e.g. "Run a command"
  detail: string | null; // the command, file or description
}

export interface QuestionPreview {
  question: string;
  header: string | null;
  options: { label: string; description: string | null }[];
  multiSelect: boolean;
  count: number; // how many questions the form holds; only single questions can be answered here
}

export interface Activity {
  kind: StatusKind;
  since: number; // epoch ms when this status started
  label: string; // "Working", "Needs your approval", ...
  detail: string | null; // one plain line under the label
  tool: ToolPreview | null; // the pending tool call, for approvals
  question: QuestionPreview | null;
  askedYou: boolean; // the last reply ends with a question to you
}

export interface ChatLine {
  role: "user" | "assistant" | "tool";
  text: string;
  at: string | null; // ISO time
}

export interface GitInfo {
  root: string; // worktree root
  mainRoot: string; // the repo's main worktree
  isWorktree: boolean;
  branch: string | null;
  dirty: number; // changed + untracked files
  insertions: number;
  deletions: number;
  ahead: number; // commits not on the upstream (or origin/main when no upstream)
  behind: number;
  upstream: string | null;
  remote: { owner: string; name: string } | null;
}

export type CheckState = "passing" | "failing" | "pending" | "none";

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  review: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  checks: CheckState;
  checksSummary: { passed: number; failed: number; pending: number };
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  updatedAt: string;
  mergedAt: string | null;
}

export interface Story {
  id: number;
  name: string;
  state: string | null;
  url: string;
  type: string | null;
  owners: string[];
}

export interface Claim {
  repo: string; // main worktree of the repo whose registry holds the claim
  worktree: string;
  branch: string;
  note: string;
  paths: string[];
  leases: string[];
  live: boolean;
}

export interface Summary {
  headline: string; // what the session works on, in plain English
  now: string | null; // what it is doing or finished, in plain English
  source: "ai" | "story" | "claim" | "title" | "prompt" | "none";
  updatedAt: number | null;
}

export interface Session {
  pid: number;
  shellPid: number; // the terminal shell that runs claude
  sessionId: string;
  name: string; // best display title: the VS Code tab's name when it has one
  nameSource: "tab" | "custom" | "title" | "story" | "summary" | "branch" | "folder";
  shortName: string; // Claude's derived name, e.g. "storefront-9a"
  cwd: string;
  startedAt: number;
  lastActivityAt: number;
  activity: Activity;
  summary: Summary;
  firstPrompt: string | null;
  chat: ChatLine[]; // the last few lines, oldest first
  git: GitInfo | null;
  pr: PullRequest | null;
  story: Story | null;
  storyId: number | null;
  claims: Claim[];
  model: string | null; // display name, e.g. "Opus 5.5"
  effort: string | null;
  effortIsDefault: boolean;
  contextPercent: number | null;
  costUsd: number | null;
  repoName: string; // e.g. "storefront"
  where: "vscode" | "tmux" | "terminal" | "other";
  vscodeLinked: boolean; // the VS Code helper can reach this terminal
  transcriptPath: string | null;
  tmux: string | null;
  remoteUrl: string | null; // claude.ai link while Remote Control is on
}

export interface RateWindow {
  usedPercent: number;
  resetsAt: number; // epoch ms
}

export interface Usage {
  fiveHour: RateWindow | null;
  sevenDay: RateWindow | null;
  observedAt: number | null; // when a session last reported these numbers
}

export interface Account {
  email: string | null;
  orgName: string | null;
  plan: string | null;
  loggedIn: boolean;
}

export interface PowerState {
  sleepDisabled: boolean | null; // null = could not read
  passwordless: boolean; // a sudoers rule lets us toggle without a password prompt
}

export interface SetupState {
  statusLine: "installed" | "missing" | "foreign"; // foreign = the user has their own status line, we wrap it
  hooks: boolean; // the permission hook that tells what an approval prompt asks
  vscodeHelper: "connected" | "outdated" | "installed" | "missing"; // outdated = connected, but too old to rename tabs
  vscodeWindows: number;
  ghReady: boolean;
  shortcutReady: boolean;
}

export interface Settings {
  notifications: boolean;
  sounds: boolean;
  aiSummaries: boolean;
  inactiveAfterMinutes: number;
  includeIdePanel: boolean;
  layout: "fit" | "comfortable" | "focus";
  shortcutTokens: string[]; // masked when sent to the UI
}

export interface Snapshot {
  at: number;
  sessions: Session[];
  usage: Usage;
  account: Account;
  power: PowerState;
  setup: SetupState;
  settings: Settings;
}

export type WorktreeVerdict = "safe" | "probably-safe" | "keep" | "in-use" | "main" | "gone";

export interface WorktreeReport {
  path: string;
  branch: string | null;
  verdict: WorktreeVerdict;
  reason: string; // one plain sentence
  dirty: number;
  unpushed: number;
  unpushedKnown: boolean;
  pr: { number: number; state: string; url: string } | null;
  liveSessions: number[]; // pids working inside it
  claim: { live: boolean; note: string } | null;
  lastCommitAt: string | null;
}

export interface ClosePlan {
  pid: number;
  claims: Claim[];
  worktree: WorktreeReport | null; // null when the session is not in a linked worktree
}

export interface CloseRequest {
  close: boolean;
  deleteWorktree: boolean;
  force: boolean; // discard unsaved work in the worktree
}

export interface ActionResult {
  ok: boolean;
  message: string;
  log?: string[];
}
