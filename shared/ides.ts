// The IDEs "Open in …" can use. The server finds each app and tells which IDE a terminal runs in; the UI shows the name.

export interface Ide {
  id: string;
  name: string;
  apps: readonly string[]; // app bundle names, looked up in /Applications and ~/Applications
  process: RegExp; // matches the IDE process that hosts its terminals
}

export const IDES = [
  { id: "vscode", name: "VS Code", apps: ["Visual Studio Code.app"], process: /Code Helper|Visual Studio Code/ },
  { id: "cursor", name: "Cursor", apps: ["Cursor.app"], process: /Cursor Helper|\/Cursor\.app\// },
  {
    id: "pycharm",
    name: "PyCharm",
    apps: ["PyCharm.app", "PyCharm Professional Edition.app", "PyCharm CE.app", "PyCharm Community Edition.app"],
    process: /\/PyCharm[^/]*\.app\//,
  },
  {
    id: "intellij",
    name: "IntelliJ IDEA",
    apps: ["IntelliJ IDEA.app", "IntelliJ IDEA Ultimate.app", "IntelliJ IDEA CE.app", "IntelliJ IDEA Community Edition.app"],
    process: /\/IntelliJ IDEA[^/]*\.app\//,
  },
  { id: "webstorm", name: "WebStorm", apps: ["WebStorm.app"], process: /\/WebStorm\.app\// },
  { id: "zed", name: "Zed", apps: ["Zed.app"], process: /\/Zed\.app\// },
] as const satisfies readonly Ide[];

export type IdeId = (typeof IDES)[number]["id"];

export function isIdeId(v: unknown): v is IdeId {
  return IDES.some((i) => i.id === v);
}

export function ideName(id: IdeId): string {
  return IDES.find((i) => i.id === id)?.name ?? id;
}
