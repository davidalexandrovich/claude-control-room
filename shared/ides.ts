// The IDEs "Open in …" can use. The server finds each app and tells which IDE a terminal runs in; the UI shows the name.

export interface Ide {
  id: string;
  name: string;
  apps: readonly string[]; // app bundle names, looked up in /Applications and ~/Applications
  bundleIds: readonly string[]; // let macOS find the app when it is installed somewhere else
  process: RegExp; // matches the IDE process that hosts its terminals
  project?: true; // opens a folder as a project and writes .idea/ into it
}

export const IDES = [
  { id: "vscode", name: "VS Code", apps: ["Visual Studio Code.app"], bundleIds: ["com.microsoft.VSCode"], process: /Code Helper|Visual Studio Code/ },
  { id: "cursor", name: "Cursor", apps: ["Cursor.app"], bundleIds: ["com.todesktop.230313mzl4w4u92"], process: /Cursor Helper|\/Cursor\.app\// },
  {
    id: "pycharm",
    name: "PyCharm",
    apps: ["PyCharm.app", "PyCharm Professional Edition.app", "PyCharm CE.app", "PyCharm Community Edition.app"],
    bundleIds: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
    process: /\/PyCharm[^/]*\.app\//,
    project: true,
  },
  {
    id: "intellij",
    name: "IntelliJ IDEA",
    apps: ["IntelliJ IDEA.app", "IntelliJ IDEA Ultimate.app", "IntelliJ IDEA CE.app", "IntelliJ IDEA Community Edition.app"],
    bundleIds: ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
    process: /\/IntelliJ IDEA[^/]*\.app\//,
    project: true,
  },
  { id: "webstorm", name: "WebStorm", apps: ["WebStorm.app"], bundleIds: ["com.jetbrains.WebStorm"], process: /\/WebStorm\.app\//, project: true },
  { id: "zed", name: "Zed", apps: ["Zed.app"], bundleIds: ["dev.zed.Zed"], process: /\/Zed\.app\// },
] as const satisfies readonly Ide[];

export type IdeId = (typeof IDES)[number]["id"];

export function isIdeId(v: unknown): v is IdeId {
  return IDES.some((i) => i.id === v);
}

export function ideById(id: IdeId): Ide | null {
  return IDES.find((i) => i.id === id) ?? null;
}

export function ideName(id: IdeId): string {
  return IDES.find((i) => i.id === id)?.name ?? id;
}

/** Where "Open in …" takes a session: tmux to Terminal, a session in an IDE's terminal to that IDE, the rest to the Settings choice. */
export type OpenTarget = { kind: "tmux" } | { kind: "ide"; ide: IdeId };

export function openTarget(s: { tmux: string | null; ide: IdeId | null }, chosen: IdeId): OpenTarget {
  if (s.tmux) return { kind: "tmux" };
  return { kind: "ide", ide: s.ide ?? chosen };
}

/** The word after "Open in", "Answer in" and "Reply in". */
export function targetName(t: OpenTarget): string {
  return t.kind === "tmux" ? "Terminal" : ideName(t.ide);
}
