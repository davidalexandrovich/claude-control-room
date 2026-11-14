// Types shared by the server and the web UI. The server produces every value; the UI only reads.
import type { CustomAgent } from "./agents.ts";
import type { IdeId } from "./ides.ts";

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
  epic: string | null; // the name of its epic
  state: string | null;
  url: string;
  type: string | null;
  owners: string[];
}

/** A page the session published on claude.ai with Claude Code's Artifact tool. */
export interface ArtifactLink {
  url: string;
  title: string | null;
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

/** A terminal started in Control Room: a shell on a tile of its own, with no Claude Code in it. */
export interface TerminalInfo {
  command: string | null; // the program it runs now; null at the shell's prompt
  screen: string[]; // the last lines on its screen, for its tile
}

export interface Session {
  pid: number;
  shellPid: number; // the terminal shell that runs claude
  sessionId: string;
  name: string; // best display title: the VS Code tab's name when it has one
  nameSource: "tab" | "saved" | "custom" | "title" | "new" | "story" | "summary" | "branch" | "folder";
  shortName: string; // Claude's derived name, e.g. "storefront-9a"
  cwd: string;
  startedAt: number;
  lastActivityAt: number;
  lastUsedAt: number; // when you last sent it a message or did something to it here
  sortKey: number; // the list runs from the biggest down: lastUsedAt, or where you dropped the card
  activity: Activity;
  summary: Summary;
  firstPrompt: string | null;
  chat: ChatLine[]; // the last few lines, oldest first
  git: GitInfo | null;
  pr: PullRequest | null;
  story: Story | null;
  storyId: number | null;
  artifacts: ArtifactLink[]; // pages it published, the latest first
  claims: Claim[];
  model: string | null; // display name, e.g. "Opus 5.5"
  modelId: string | null; // e.g. "claude-opus-5-5[1m]"
  effort: string | null;
  effortIsDefault: boolean;
  mode: string | null; // permission mode, e.g. "auto", "plan"
  contextPercent: number | null;
  costUsd: number | null;
  repoName: string; // e.g. "storefront"
  ide: IdeId | null; // the IDE whose terminal runs the session
  vscodeLinked: boolean; // the VS Code helper can reach this terminal
  transcriptPath: string | null;
  tmux: string | null;
  hosted: boolean; // runs in Control Room's own tmux, so its console works here
  remoteUrl: string | null; // claude.ai link while Remote Control is on
  terminal: TerminalInfo | null; // set for a terminal: then pid is its shell's, and sessionId its tmux name
  agent: { id: string; label: string } | null; // set for another coding agent, such as Codex: a terminal that runs it
  account: AccountRef | null; // the other Claude account it runs on; null for the usual one
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

/** Another coding agent's limits, as it last reported them; Codex keeps them in its session files. */
export interface AgentUsage {
  id: string; // "codex"
  label: string;
  plan: string | null;
  windows: AgentWindow[]; // shortest first; empty once they all reset
  observedAt: number; // when it last reported them
}

export interface AgentWindow {
  label: string; // "5-hour", "Week"
  minutes: number;
  usedPercent: number;
  resetsAt: number; // epoch ms
}

export interface Account {
  email: string | null;
  orgName: string | null;
  plan: string | null;
  loggedIn: boolean;
}

/** A Claude account besides the usual one: its own login, in its own Claude Code config folder (CLAUDE_CONFIG_DIR). */
export interface AccountRef {
  label: string; // "Personal"
  dir: string; // absolute
}

export interface OtherAccount extends Account, AccountRef {
  usage: Usage;
  connected: boolean; // Control Room's status line and hook are in its settings too
}

export interface PowerState {
  sleepDisabled: boolean | null; // null = could not read
  passwordless: boolean; // a sudoers rule lets us toggle without a password prompt
}

export interface SetupState {
  statusLine: "installed" | "missing" | "foreign"; // foreign = the user has their own status line, we wrap it
  hooks: boolean; // the permission hook that tells what an approval prompt asks
  links: boolean; // the link opener ($BROWSER), so a session's links open in its account's Chrome profile
  vscodeHelper: "connected" | "outdated" | "installed" | "missing"; // outdated = connected, but too old to rename tabs
  vscodeWindows: number;
  ides: IdeId[]; // installed on this Mac
  tmuxReady: boolean; // needed to start sessions here
  ghReady: boolean;
  shortcutReady: boolean;
  agents: AgentChoice[]; // the coding agents besides Claude Code that New session offers
}

export interface AgentChoice {
  id: string;
  label: string;
  installed: boolean; // its program is on your PATH
  takesPrompt: boolean; // false: it starts empty, and you type the first message in its console
}

export interface Settings {
  notifications: boolean;
  sounds: boolean;
  aiSummaries: boolean;
  inactiveAfterMinutes: number;
  includeIdePanel: boolean;
  ide: IdeId; // where "Open in …" opens a session
  terminalFolder: string; // where a new terminal starts
  layout: "fit" | "comfortable" | "focus";
  shortcutTokens: string[]; // masked when sent to the UI
  accounts: AccountRef[]; // Claude accounts besides the one in ~/.claude
  defaultAccountLabel: string; // the name of that one here: "Default" until you give it another, such as "Work"
  newSessionAccount: string; // the folder of the account New session starts on: "" for the one in ~/.claude
  prompts: SavedPrompt[]; // your own prompts, to start a session with or paste into one
  agents: CustomAgent[]; // coding agents of your own for New session, besides the built-in ones
}

export interface SavedPrompt {
  id: string;
  title: string; // what its chip says
  text: string;
  // What a session started with it runs on; "" leaves New session's choice as it is.
  model: string;
  effort: string;
  mode: string;
}

export interface Snapshot {
  at: number;
  sessions: Session[];
  usage: Usage;
  agentUsage: AgentUsage[]; // the other coding agents that report their limits
  account: Account;
  otherAccounts: OtherAccount[]; // in the order of Settings
  power: PowerState;
  setup: SetupState;
  settings: Settings;
  update: UpdateState;
}

/** Updating the app from the git checkout it was built from. */
export interface UpdateState {
  source: string | null; // that checkout; null when the app was not built from one
  built: string | null; // the commit this app was built from
  builtAt: string | null;
  branch: string | null;
  upstream: string | null; // e.g. "upstream/main"; null when the branch follows none
  behind: number; // commits the upstream has that the checkout lacks
  unbuilt: number; // commits in the checkout that this app was not built with
  incoming: string[]; // subjects of the newest of those commits
  dirty: boolean; // uncommitted changes in the checkout, which go into the build too
  checkedAt: number | null;
  phase: "idle" | "pulling" | "installing" | "building" | "restarting" | "failed";
  message: string | null;
  restarts: boolean; // the app swaps the new build in by itself
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
