<p align="center">
  <img src="build/icon.png" width="112" alt="">
</p>

<h1 align="center">Control Room</h1>

<p align="center">
  <b>Every Claude Code session on one screen.</b><br>
  See which one needs you, and answer it right from your menu bar.
</p>

<p align="center">
  <img alt="macOS menu bar app" src="https://img.shields.io/badge/macOS-menu%20bar%20app-1f2937?logo=apple&logoColor=white">
  <img alt="Runs only on your Mac" src="https://img.shields.io/badge/runs-100%25%20local-0f766e">
  <img alt="Made for Claude Code" src="https://img.shields.io/badge/made%20for-Claude%20Code-d97757">
</p>

<p align="center">
  <img src="docs/images/hero.png" alt="The Control Room dashboard, with the menu bar panel open over it" width="100%">
</p>

<p align="center"><sub>Real screenshots of the app. The sessions are samples from <code>npm run demo</code>.</sub></p>

---

You run five Claude Code sessions. You switch to email for a minute.
One session asks for permission. Another one asks you a question.
Forty minutes later, both are still waiting for you.

**Control Room fixes this.** It lives in your Mac's menu bar and watches every session for you.
When a session needs you, you see it right away, and you answer with one click.
No more searching through terminal tabs.

## What you get

- 🔍 **It finds every session.** Start `claude` in any terminal, and it shows up a moment later.
- ⌨️ **No terminal needed.** Start a session here with **New session**, and type to it in its console in the dashboard.
- 🎛️ **Model, effort and mode on every tile.** Click one in the tile's footer to change it for that session.
- 🚦 **Live status in plain words:** working, needs your approval, asked you a question, waiting for your reply, idle, inactive.
- ✅ **Approve, reject and answer** from the dashboard or from the menu bar. You see the exact command first.
- 📱 **Take a session to your phone.** Click **rc** on its tile, and the session shows up in the Claude app. It keeps running on your Mac.
- 🏷️ **The same names as your VS Code tabs.** A tile shows the name of its terminal tab. Rename a session here, and its tab gets the new name too.
- 🗣️ **Plain-English summaries.** Each session says what it works on in one short sentence. Anyone on the team can read it.
- 🔀 **Git and GitHub on every tile:** branch, changes, pull request, checks and review.
- 📊 **Your Claude usage:** the 5-hour and weekly limits, with their reset times.
- 🖥️ **Made for many screens.** Put a wall of sessions on any display, or pop one session out to its own window.
- 🔔 **Alerts with on/off switches:** desktop notifications and a soft chime.
- 🧹 **Safe cleanup.** Close a session and delete its worktree, with clear advice about unsaved work.
- ☕ **Keep awake.** One switch keeps your Mac awake, even with the lid closed, so long runs can finish.

> [!TIP]
> **Want to look first?** Run `npm install && npm run demo`, then open http://127.0.0.1:4318.
> You get the real app with sample sessions. The demo reads nothing from your Mac.

## A quick tour

### It lives in your menu bar

<table>
  <tr>
    <td width="44%"><img src="docs/images/menubar.png" alt="The menu bar panel: two sessions need you, live sessions, Claude usage and quick switches"></td>
    <td>
      <p>Click the icon next to the clock. A panel opens with:</p>
      <ul>
        <li><b>Needs you:</b> each waiting session, with <b>Approve</b>, <b>Reject</b> or its answer buttons.</li>
        <li><b>Sessions:</b> everything that runs, newest first, with its PR. A green phone means the session is on your phone too.</li>
        <li><b>Claude usage:</b> your 5-hour and weekly limits.</li>
        <li><b>Quick switches:</b> notifications, sounds and keep awake.</li>
      </ul>
      <p>The number next to the icon shows how many sessions wait for you.
      Right-click the icon for a menu: open the dashboard, show the wall on a display, open at login, or quit.</p>
    </td>
  </tr>
</table>

### Every session on one screen

<img src="docs/images/dashboard.png" alt="The dashboard: an overview on top and a wall of session tiles below">

The overview on top counts your sessions, lists what needs you, and shows your pull requests and usage.
You can arrange its cards the way you like:

- **Minimize a card:** click its **−**. It becomes a small chip beside the other cards, showing what matters, such as `Needs you 2`. The chip turns amber while something needs you. Click a chip to bring its card back.
- **Resize cards:** drag the gap between two cards to make one wider and the other narrower. Double-click a gap to go back to the usual widths.
- **Minimize all of them:** click **^** in the top bar. The cards fold into one slim row of chips, so the wall, and the console in Focus, get the room. Click it again to bring back the cards you had open.

Your arrangement is kept on this Mac.
Below it, each session is a tile, like a monitor on a wall. Every tile has three parts:

- **Top:** the name, the **rc** button, the task in plain English, and chips for the PR, the story and the branch.
- **Middle:** the status, big and clear, with buttons when the session needs you.
- **Bottom:** model · effort · repository, and a ring that shows how full the context window is.

The session you used last comes first: the one you last sent a message, from any terminal, or typed to, answered or changed here.
Claude's own work does not move a tile, so the wall holds still while sessions run.
Drag a tile anywhere to put it there. It stays there until you use that session again.

Right-click a tile, or a row in Focus, for everything you can do to that session without opening it:
answer it, open its console, rename it, change its model, effort and mode with one click each,
send it to your phone, open its PR, put it first or last, copy its resume command, or close it.

### Answer without leaving

<img src="docs/images/needs-you.png" alt="Two tiles: one needs approval for a command, one asks a question with three answer buttons">

An approval shows the exact command. A question shows its options as buttons.
One click sends your answer to the right terminal.
Right before it presses a key, Control Room checks the session again, so an old card can never approve the wrong thing.

### Start and type here

Click **New session** at the top, or press `N`. Pick a folder, add a first message if you like, and press `Enter` or click **Start session**. `Shift+Enter` adds a line to the message.
Claude Code starts in Control Room, and its details open with a live console.
The console is the session's real terminal: type messages, slash commands, `Esc`, `Ctrl+C`, arrows, and paste, as in any terminal tab.
`Shift+Enter` starts a new line in your message.
The bar above the console works like a window's title bar. **A↓** and **A↑** change the text size; click the number for the usual size.
**−** minimizes the console to its bar, and **⤢** fills the whole window with it. Double-click the bar to do the same, and press `Esc` outside the console to go back.
Drag the left edge of the details panel to make it wider or narrower. Double-click the edge for the usual width.
The console has edges and corners of its own: drag the top or bottom for its height, a side for its width, a corner for both. Double-click an edge to reset it.

### Other coding agents

Codex, Gemini, Cursor Agent, Kimi Code and Ollama can run here too, next to Claude Code. Pick one under **Agent** in **New session**. Only the ones installed on your Mac can be picked. **Settings → Coding agents** lists each one, and shows the install command for any that's missing.

- **How it runs:** in a console here, the same as in a terminal tab. Your login shell starts it, so it finds the same PATH as your terminal. Sign in to each agent in its console the first time.
- **The first message** goes over as one argument. Kimi Code and Ollama start empty, so type the first message in their console.
- **Ollama** opens its own menu, where you pick a coding tool, such as Codex or OpenCode, and a local or cloud model. When Ollama isn't running, its server starts for that console and stops when you close it.
- **When one fails to start,** its console stays open until you press Enter, so you can read why.
- **Its tile** shows its screen, the same way a terminal's does. **Working** means its screen moves. **Stopped · check it** means its screen has stood still for a few seconds after working. It may be done, or asking you something, so you get a desktop notice to look. **Inactive** comes after the same idle time as for sessions.
- **Usage:** Codex's 5-hour and weekly limits show under Claude's in the usage card and the menu bar, read from the session files Codex writes on each reply, wherever it runs. The others keep their usage on their own side, so the card says where to look: `/stats` in a Gemini console, `/usage` in a Kimi console, your dashboard on cursor.com. Ollama's local models have no limits.
- **What only Claude Code gets:** approvals, model, effort, mode and plain-English summaries all come from Claude Code's own files. For another agent, answer what it asks, and change its settings, in its console.
- **Your own agent:** in **Settings → Coding agents**, add a name and the command, as you'd type it, for example `aider --model sonnet --message {prompt}`. `{prompt}` is where the first message goes. It's passed as one argument, never run as shell code.

### Saved prompts

Keep the prompts you type again and again, and use one in a click.

- **Save one:** type it as the first message in **New session** and click **Save as prompt**, or add it in **Settings → Saved prompts**.
- **Start with one:** in **New session** your prompts are chips above the first message. A click puts that prompt in the box, after anything you've already typed. Edit it if you like, then press `Enter`. Clicking another chip swaps in that prompt instead, so you can look through them freely. The chip in use is highlighted with an **×**: click it to take its prompt out. Once you've edited the message yourself, a chip goes after your text, so nothing you wrote is lost.
- **Slots to fill in:** write `<PR URL>`, `<ticket>` or any `<name>` in a prompt, for example `review <PR URL> against <ticket>`. When it's the first message in **New session**, each slot gets a line of its own, and the cursor starts in the first one. `Enter` goes to the next line, and on the last one it starts the session. What you type replaces the slot in the message. A slot you leave empty stays as it is, so Claude asks you for it. Click **×** on a line to close it; its slot stays in the message. The saved prompt keeps its slots for next time.
- **Its own model, effort and mode:** give a prompt the ones it works best with in **Settings → Saved prompts**, such as Opus · xhigh · plan for a planning prompt. A click on its chip sets them in **New session**, and says **Set by** that prompt. **Any** leaves that choice as it is. A prompt's settings never become your defaults: the next **New session** opens with the ones you picked yourself. **Save as prompt** keeps the model, effort and mode chosen in the dialog.
- **Use one in a running session:** click the speech-bubble button on the console's bar and pick one. It's pasted at Claude Code's prompt but not sent, so you can change it first. Press `Enter` to send it.
- **From the top bar:** click **Prompts**, next to **Notifications**.
  - Click a prompt to copy it, then paste it into any session, including one in VS Code or a Terminal tab.
  - **▶** starts a new session with it.
  - **Add or edit prompts** opens them in Settings.
- **Rename, change or delete:** in **Settings → Saved prompts**, with each prompt's model, effort and mode. A prompt with no name shows its first words. Changes save when you leave the field. Deleting takes a second click.

They're saved on this Mac in `~/.claude-control-room/config.json`, and are the same for every account.

A session started here keeps running when you quit Control Room. It is back in its console when the app opens again.
Close it with **Close…**, or type `/exit` in its console.

A session that runs in another terminal, like PyCharm's, shows **Move here** once it is idle.
Control Room stops it there and continues the same conversation here, with `claude --resume`. Then its old terminal tab is no longer needed.
It keeps its model, effort and mode.

### Model, effort and mode

A tile's footer shows the session's model, effort and permission mode, for example `Opus 5.5 · xhigh · auto`.
Click one to pick another. The change is for that session only: your defaults for new sessions stay as they were.
**New session** asks for all three. The mode starts on **auto**.

Control Room types `/model` or `/effort` into the session, as you would. When Claude Code asks to confirm the switch, Control Room says yes. So it changes them for sessions it can type into: the ones started here, the ones in tmux, and VS Code terminals with the helper. The model and effort change between turns.
The mode changes with Shift+Tab, so Control Room has to read the screen: it does this for sessions started here and the ones in tmux.
For a session in another terminal, like PyCharm's, click **Move here** first.

### Take it with you

Leaving your desk? Click **rc** on a session's tile, or **Remote control** in its details.
Control Room types Claude Code's `/remote-control` into that session, the same command you would type yourself.
A second later, the session is in the Claude app on your phone, under **Code**, and at [claude.ai/code](https://claude.ai/code).
It keeps running on your Mac, so you can reply from your phone or from the terminal.

A green **rc** means the session is on your phone. Click it to open the session at claude.ai.
It works while Claude is busy too. Only a session that is asking you something must get its answer first.

### Two Claude accounts

Keep a personal account next to your work one. Claude Code keeps each login in its own config folder (`CLAUDE_CONFIG_DIR`), and Control Room reads them all.
Add one in **Settings → Claude accounts**: a name, such as Personal, and a folder, such as `~/.claude-personal`. Click **Sign in** and pick the account.
The sign-in opens in a private window (Chrome, Brave, Edge or Firefox, the first one you have), so your browser's own claude.ai stays signed in to your work account.

**New session** then asks which account to use. It starts on the default one each time, or on the one set in **Settings → Claude accounts → New sessions start on**. A session on another account has its name in pink on the tile, in Focus and in its details.
To see one account's sessions, pick it next to the filters above the wall, or click its count in the Sessions card. **Default** is every session that is not on another account.
Sessions you start yourself show up too: `CLAUDE_CONFIG_DIR=~/.claude-personal claude`.
The usage card shows each account's limits, once **Connect Claude Code** has added the status line to that account as well.
Links open in the Chrome profile signed in to the session's account: a link a personal session opens, or that you click on its tile or in its console, goes to the Chrome of your personal Google account, and a work session's to your work one. Control Room matches them by email. A session whose account has no Chrome profile with that email opens links in your default browser, as before. `open` run in a session's shell still goes to the default browser.
**Move here**, **Copy resume command** and the model and effort switches keep each session on its own account.
Click an account's name in Settings to rename it: call the default one "Work", say. Removing an account takes it out of Control Room only. Its folder and login stay.

### Names you choose

A tile has the same name as the session's VS Code terminal tab.
Rename the tab in VS Code, and the tile follows within two seconds.

To rename from Control Room, click ✏️ on the tile, or next to the name in the details. Type the new name and press Enter, or click elsewhere.
The VS Code tab gets the new name too. Esc cancels.
A session in another terminal, like PyCharm's, keeps the name in Control Room only. Its terminal tab does not change.
That name wins over `/rename`. To go back to the automatic name, rename it to nothing: clear the box and press Enter.
A tab you never named shows only the program's name, like `claude`. Then the tile uses Claude Code's own title for the session.

### Plain English, for everyone

<table>
  <tr>
    <td width="48%"><img src="docs/images/details.png" alt="Session details: summary, branch, changes, PR, story, model and the live conversation"></td>
    <td>
      <p>Click a tile to see its details:</p>
      <ul>
        <li>what the session works on, and what it does right now;</li>
        <li>its branch, changes, pull request and story;</li>
        <li>the pages it published on claude.ai with the Artifact tool, and an <b>Artifact</b> button that opens the latest one;</li>
        <li>the model, effort, context size and cost;</li>
        <li>the live conversation.</li>
      </ul>
      <p>The branch and changes are those of the checkout it works in. A session started in your main checkout that
      went on to work in a worktree beside it, with <code>cd ../shield-27336</code> or edits there, shows that worktree.
      Going back to the main checkout to run its tools doesn't count.</p>
      <p>The short summaries come from Claude Haiku, through your own <code>claude</code> command.
      They are written for people, not only for engineers.</p>
    </td>
  </tr>
</table>

### A wall of monitors, on any screen

<img src="docs/images/wall.png" alt="The wall on its own display: twelve sessions in a grid">

Choose **Wall on display** to put the wall on another screen. On a display of its own, it opens full screen.
The tiles resize so every session fits, like a real control room.
To watch just one session, pop it out to its own window and drag it to any screen.

### Focus on one session

<img src="docs/images/focus.png" alt="Focus layout: one session large on the left, the other sessions in a list on the right">

**Focus** shows one session large, with the others in a list beside it. Press `1` to `9` to switch.

### Close cleanly

<table>
  <tr>
    <td width="40%"><img src="docs/images/close.png" alt="The close dialog: release claims, delete the worktree, and the advice 'Safe to delete'"></td>
    <td><img src="docs/images/worktrees.png" alt="Worktree cleanup: five worktrees that are safe to delete, all selected"></td>
  </tr>
</table>

The **×** on a tile asks two things:

- ☑ **Close the session and release its claims.** On by default.
- ☐ **Delete the worktree.** Off by default. Next to it, you get advice: *Safe to delete*, *Probably safe*, *Keep it for now*, or *In use*. To delete work that is not saved, you must tick one more box.

**Worktree cleanup** (This Mac → Clean up) checks every worktree of a repo for uncommitted changes, unpushed commits, open pull requests and live sessions.
It deletes folders only. Your branches stay, on GitHub and on your Mac.

## Install

**You need:**

- A Mac. It is tested on macOS 15 Sequoia with Apple silicon.
- [Node.js](https://nodejs.org) 22 or newer.
- [Claude Code](https://github.com/anthropics/claude-code) (the `claude` command).
- Optional: the [GitHub CLI](https://cli.github.com) `gh`, signed in, for pull request status.
- Optional: [tmux](https://github.com/tmux/tmux), to start sessions and type to them in Control Room: `brew install tmux`.
- Optional: [VS Code](https://code.visualstudio.com), to jump to a session's terminal and to answer from the dashboard.
  **Open in** also works with Cursor, PyCharm, IntelliJ IDEA, WebStorm and Zed. A session opens in the IDE whose terminal runs it.
  Sessions in other terminals open their folder in the IDE you pick in **Settings → Open other sessions in**.
  Until you pick one, it is VS Code. When VS Code is not there, it is the IDE Claude Code is connected to, else the first IDE in Applications.
  A session started here keeps its console, and **Open in …** beside it opens its folder in that IDE, to see the changes.
  PyCharm, IntelliJ IDEA and WebStorm open only git repos, because they add a `.idea/` folder to what they open.
  Put `.idea/` in your global gitignore, or worktree cleanup counts it as unsaved work.
- Optional: for **rc**, the Claude app on your phone, and Claude Code signed in with a claude.ai plan. See [Remote Control](https://code.claude.com/docs/en/remote-control).

**Build and install (about 3 minutes):**

```bash
git clone https://github.com/davidalexandrovich/claude-control-room.git
cd claude-control-room
npm install
npm run package
ditto "release/mac-arm64/Control Room.app" "/Applications/Control Room.app"
open "/Applications/Control Room.app"
```

On an Intel Mac, the app is in `release/mac` instead of `release/mac-arm64`.

The app is signed for your Mac only. That is normal for an app you build yourself, and macOS opens it without a warning.
If macOS ever blocks it, open **System Settings → Privacy & Security** and click **Open Anyway**.

**On the first start:**

- The dashboard opens, and the icon appears in the menu bar, next to the battery and Wi-Fi icons.
- **Open at login** turns on by itself, so the icon is back after every restart.
- The Dock icon shows only while a Control Room window is open. Closing the window keeps the app in the menu bar.

### Finish setup (one time)

A banner at the top of the dashboard offers two steps:

1. **Connect Claude Code.** This adds a status line, a quiet `PermissionRequest` hook and a link opener (`env.BROWSER`) to `~/.claude/settings.json`, and to the `settings.json` of each other Claude account. It saves a backup first. A `BROWSER` you set yourself stays as it is.
   With them, the dashboard knows your usage limits, the model, the effort, and what each approval asks.
   The status line also shows `model · effort · context · 5h · week` in your terminal.
   **Settings → Claude Code → Disconnect** removes both and gives your old status line back.
2. **Install the VS Code helper.** This is a tiny local extension. It tells the dashboard which VS Code terminal runs which session.
   Then **Open in VS Code** shows the right terminal, and Approve, Reject and answers work from the dashboard.
   Tiles also take the names of your terminal tabs, and you can rename them from the dashboard.
   If a VS Code window does not connect within a minute, run **Developer: Reload Window** in it. Your terminals survive the reload.

You can also do these later, in **Settings**:

- **Shortcut:** paste an API token to see story names and states. The app finds `sc-12345` in the branch, a note or the chat.
- **Keep awake without a password:** the switch runs `pmset`, so macOS asks for your password each time. Settings shows one sudoers rule that allows only these two commands.
- **AI summaries:** on by default. You can turn them off.

### Update

Click **Update** at the top of the dashboard when it shows, or open **Settings → Update**.
Control Room pulls the new commits into the folder it was built from, builds itself again (about 3 minutes) and restarts. Sessions started in Control Room keep running.
It pulls only when the branch can fast-forward; otherwise it says so and changes nothing. Uncommitted changes in that folder go into the build too.

By hand, it is:

```bash
git pull && npm install && npm run package
```

Then quit Control Room (right-click the icon → **Quit**), copy the new app over the old one, and open it again:

```bash
rsync -a --delete "release/mac-arm64/Control Room.app/" "/Applications/Control Room.app/"
open "/Applications/Control Room.app"
```

If **Settings** then says the VS Code helper is outdated, click **Update**.
Then run **Developer: Restart Extension Host** in VS Code. Your terminals keep running.

### Uninstall

1. In the dashboard, open **Settings → Claude Code → Disconnect**. This puts your old status line back.
2. Right-click the menu bar icon. Turn off **Open at login**, then choose **Quit**.
3. Delete `/Applications/Control Room.app`.
4. Optional: delete `~/.claude-control-room` (settings and small caches) and `~/Library/Application Support/Control Room`.
5. Optional: in VS Code, uninstall the extension **Control Room Bridge**.

## Everyday use

| To… | Do this |
|---|---|
| See what needs you | Click the menu bar icon. |
| Open the dashboard | Click **Open dashboard** in the panel, or press ⌘ Space and type "Control Room". |
| Put the wall on another screen | Click **Wall on…** in the panel, or **Wall on display** in the dashboard. |
| Watch one session on its own | Click the pop-out button on its tile. |
| Continue a session on your phone | Click **rc** on its tile. Then open the Claude app and tap **Code**. |
| Start a session and type to it | Click **New session**, pick a folder, click **Start session**. Type in its console. |
| Reuse a prompt you type often | Save it with **Save as prompt** in **New session**. Then click its chip there, pick it from the speech-bubble button on a console's bar, or copy it from **Prompts** at the top. |
| Use a second Claude account | Add it in **Settings → Claude accounts** and sign in. Then pick it under **Account** in **New session**. |
| Open a terminal | Click **Terminal** at the top, or press `T`. A shell starts in the folder from **Settings → Start terminals in**, on a green tile with its screen. Click the tile to type in it. It keeps running when the app quits. With zsh, each command goes to your history as it runs, so `⌃R` finds it in every terminal. A terminal gets your own editor and keys, even when Control Room was started from a Claude Code session. |
| See the changes of a session started here | Click **Open in …** in its details, or right-click it. Its folder opens in the IDE from Settings. |
| Stop using a terminal for a session | Open its details and click **Move here**, once it is idle. |
| Change a session's model, effort or mode | Click it in the tile's footer and pick another, or right-click the tile. |
| Do anything to a session without opening it | Right-click its tile, or its row in Focus. |
| Make the details panel wider | Drag its left edge. Double-click the edge to go back. |
| Make the console taller or shorter | Drag its top or bottom edge, or a corner. |
| Put a session's tile somewhere else | Drag it there. |
| Make the console text bigger | Click **A↑** above the console. |
| Give the console the whole window | Click **⤢** above it, or double-click its bar. `Esc` outside the console goes back. |
| Update Control Room | Click **Update** at the top, or **Settings → Update**. |
| Rename a session | Click ✏️ on its tile or in its details, type the name, press Enter or click elsewhere. Its VS Code tab gets the name too. |
| Move the icon | Hold ⌘ and drag the icon along the menu bar. |
| Quit | Right-click the icon and choose **Quit**. |

<details>
<summary><b>Keyboard shortcuts</b></summary>

<br>

Press `⌘/` or `?` to see them all in the app. Hover a button, or right-click a session, to see each shortcut. The `⌘` and F-key ones follow PyCharm and work while you type in a console too.
In a session's right-click menu, the keys act on that session, and `1` – `4` pick an answer to its question.

| Key | Action |
|---|---|
| `⌘N` or `N` | Start a new session |
| `⌘T` or `T` | Open a terminal |
| `⌘,` | Settings |
| `⌘/` or `?` | Keyboard shortcuts |
| `⌘K` or `⌘E` | Go to a session: type part of its name, repo or branch, then `↵` |
| `⌘↓` `⌘↑`, `⌃⇥` `⌃⇧⇥`, or `→` `←` | Next or previous session |
| `↑` `↓` | The session above or below |
| `Home` / `End` | The first or last session |
| `⌘1` – `⌘9` or `1` – `9` | Go to that session |
| `↵` | Open the selected session: its console, or its IDE |
| `⇧Esc` | Leave the console, so the single keys work again |
| `Space` | Show or hide its details |
| `⇧F6` or `F2` | Rename it |
| `A` / `R` | Approve or reject |
| `P` | Open its pull request |
| `X` | Close the session |
| `O` | Open its folder in your IDE |
| `⇧F4` | Pop it out to its own window |
| `C` | Continue it on your phone |
| `⌥⌘R` | Show its folder in Finder |
| `⇧Home` / `⇧End` | Move it to the front or the end |
| `⌘⇧C` / `⌥⌘⇧C` | Copy its resume command or its session ID |
| `F` | Switch between Focus and Fit |
| `Esc` | Close panels |

Keys typed right after the window gets focus are ignored. So typing meant for another app cannot approve anything.

</details>

<details>
<summary><b>How it works</b></summary>

<br>

There is no database and no cloud service. About once a second, the app reads:

| Source | What it gives |
|---|---|
| `~/.claude/sessions/<pid>.json` (written by Claude Code), and the same in each other account's folder | which sessions are alive, their status, why one waits, and whether Remote Control is on |
| the process table | that each session is still a running `claude` process, and its terminal |
| the transcript `~/.claude/projects/…/<session>.jsonl` | the conversation, the current tool call, the title, PR links. It reads only the new bytes each time. |
| the status line tap | model, effort, context size, cost and usage limits |
| the permission hook | what a waiting approval or question asks |
| `git` and `gh` | branch, changes, pull request, checks and review |
| `<repo>/.git/*-sessions.json` (optional) | worktree claims, if your repo keeps a registry of which session works where |
| the Shortcut API (optional) | story names and states |
| the VS Code helper (optional) | which terminal runs each session, and the name on its tab |

The one-line summaries come from one short call to Claude Haiku, through your own `claude` command.
Each call costs about 0.03¢, and it runs only when a session has moved on.

**rc** types into the session's terminal, the same way Approve does: through `tmux`, or through the VS Code helper.
First it clears anything you typed there but did not send. Press `Ctrl+Y` in that session to get it back.
Then it types `/remote-control` and presses Enter.

A tile's name comes from the first of these that it has:
the name you gave its VS Code tab, the name you gave it in Control Room, the name from `/rename`, the Shortcut story, Claude Code's own title,
the plain-English summary, the branch, and last the folder.
A story names it `<story id>-<short title>`, such as `27336-Logistics Truck Alerts`. With AI summaries on, Haiku writes the short title once
per story, after its epic, so the sessions of one epic read alike. Otherwise the story's own name stands in.
Until its first prompt a session is called **New session**, unless it has a name you gave it or Claude Code's own title: the branch it starts on, and that branch's story, are about earlier work.
**Rename** asks the VS Code helper to rename the tab, the same as **Rename** in VS Code. It types nothing into the session.
For a session outside VS Code, the name goes to `~/.claude-control-room/names.json`, by session id.

**New session** runs `claude` in a tmux server of Control Room's own (`tmux -L control-room`), through your login shell, so it gets the same PATH and variables as a terminal tab.
Your own tmux and its config stay untouched. To look at these sessions from a terminal: `tmux -L control-room ls`.
The console is a tmux control-mode client: it streams the session's output to the page and sends your keys with `send-keys`.

</details>

<details>
<summary><b>Privacy and safety</b></summary>

<br>

- The app's server listens on `127.0.0.1` only. Other computers cannot reach it.
- It checks the `Host` and `Origin` of every request. Every action also needs a header that a web page from another site cannot send.
- Approve, Reject and **rc** read the session's status again right before they press a key. **rc** never types into a session that is asking you something.
- **Rename** changes only the VS Code tab, or for other terminals `~/.claude-control-room/names.json`. It never types into the session.
- A console types only what you type in it. It reaches only the sessions Control Room started, on its own tmux server.
- **Move here** works only on an idle session, so it never cuts off a turn. The conversation continues from Claude Code's own transcript.
- Model and effort change only on an idle session, and the mode never while the session asks you something: Shift+Tab there would approve edits.
- Shortcut tokens stay in `~/.claude-control-room/config.json`. The page only ever sees their last four characters.
- The only calls that leave your Mac are: GitHub, through your own `gh`; Shortcut, only if you add a token; and your own `claude` command, for your account status and the short summaries.
  A session's summary runs on its own account.
- After **rc**, Claude Code itself shares that session with your claude.ai account, as `/remote-control` always does. Control Room sends nothing there.
- The app keeps its own settings and caches in `~/.claude-control-room/`. The only change it makes to Claude Code is the status line and hook in `~/.claude/settings.json`, and in each other account's `settings.json`. You add them with **Connect** and remove them with **Disconnect**.
- `/model` and `/effort` also save the choice as your default for new sessions. After a change from a tile, Control Room puts your previous `model` and effort defaults back in the session's account's `settings.json`, and touches nothing else there.

</details>

<details>
<summary><b>Troubleshooting</b></summary>

<br>

**I can't see the menu bar icon.**
On a MacBook with a notch, macOS hides icons that do not fit. Hold ⌘ and drag the icon to the right, or quit another menu bar app.

**Approve and Reject are grey.**
The dashboard needs a way to type into the session's terminal. Install the VS Code helper, or run the session inside `tmux`. Until then, use **Open in …**.

**rc does not work.**
- *Can't type in this terminal:* rc needs the VS Code helper, or a session that runs in `tmux`. In other terminals, type `/rc` yourself.
- *Did not connect:* look at the session. The first time, Claude Code asks you there to confirm Remote Control.
  It also needs a claude.ai login, not an API key. On Team and Enterprise plans, an admin must turn Remote Control on first.

**Rename is grey, or does not work.**
- *Grey:* a session in a VS Code terminal needs the VS Code helper, because the name goes on its tab.
- *"Update the VS Code helper first":* click **Settings → VS Code helper → Update**. Then run **Developer: Restart Extension Host** in VS Code. Your terminals keep running.

**New session says it needs tmux.**
Install it with `brew install tmux`, then click **New session** again.

**A new session asks something first.**
In a folder Claude Code has not seen before, it asks whether you trust the folder. Answer it in the console in the dialog. The session opens once it starts.

**Move here is grey.**
The session is busy, asking you something, or running a background task. Move it once it is idle.

**An approval card shows no command.**
That session started before you connected Claude Code. Sessions you start after connecting show everything.

**Usage says "no data yet".**
Connect Claude Code, then send a message in any session. The status line reports your limits after the next reply.

**Keep awake asks for my password.**
`pmset` needs admin rights. Add the sudoers rule that **Settings → Keep awake** shows, and the switch works without a prompt.

</details>

## Develop

```bash
npm install
npm run demo         # the UI with sample sessions, at http://127.0.0.1:4318
npm run build        # UI (Vite) + server bundle + VS Code helper package
npm run app:only     # run the Mac app from source (after a build)
npm start            # the server only, then open http://127.0.0.1:4317
npm test             # rules, parsers, settings merge, layout, helper protocol, demo
npm run typecheck
npm run package      # build release/mac-arm64/Control Room.app
npm run screenshots  # take the README pictures again, from the demo
```

The code lives in:

- `server/`: the Node server. It has no runtime dependencies.
- `web/`: the React UI.
- `shared/types.ts`: the data that the server and the UI share.
- `electron/`: the Mac app shell, the menu bar icon and the panel.
- `vscode-extension/`: the VS Code helper.
- `scripts/`: icon drawing, helper packing and the screenshot script.
- `tests/`: the tests.

---

<p align="center"><sub>Made for people who run more Claude Code sessions than they can watch. Built with Claude Code.</sub></p>
