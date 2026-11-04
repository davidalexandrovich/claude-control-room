import { existsSync } from "node:fs";
import { join } from "node:path";
import { IDES, ideById, ideName, type IdeId } from "../shared/ides.ts";
import type { ActionResult } from "../shared/types.ts";
import { HOME } from "./paths.ts";
import { launch, run } from "./proc.ts";

let found: { at: number; ids: IdeId[] } | null = null;

/** The app in /Applications or ~/Applications, or null. macOS can still find an app elsewhere by its bundle id. */
export function appPath(id: IdeId): string | null {
  for (const dir of ["/Applications", join(HOME, "Applications")]) {
    for (const app of ideById(id)?.apps ?? []) if (existsSync(join(dir, app))) return join(dir, app);
  }
  return null;
}

/** The IDEs in those two folders. The monitor asks on every refresh and apps change rarely, so look once a minute. */
export function installedIdes(): IdeId[] {
  if (!found || Date.now() - found.at > 60_000) found = { at: Date.now(), ids: IDES.filter((i) => appPath(i.id) !== null).map((i) => i.id) };
  return found.ids;
}

export function ideOf(comm: string): IdeId | null {
  return IDES.find((i) => i.process.test(comm))?.id ?? null;
}

/** Starts the IDE or brings it forward: by path when it is in Applications, else through macOS by its bundle id. */
async function openApp(id: IdeId, args: string[]): Promise<boolean> {
  const app = appPath(id);
  if (app) {
    launch("open", ["-a", app, ...args]);
    return true;
  }
  for (const bundleId of ideById(id)?.bundleIds ?? []) {
    if ((await run("open", ["-b", bundleId, ...args], { timeoutMs: 10_000 })).ok) return true;
  }
  return false;
}

export function openVscode(): Promise<boolean> {
  return openApp("vscode", []);
}

/** VS Code's `code` command, from the same app "Open in" uses, or null. */
export function vscodeCli(): string | null {
  const app = appPath("vscode");
  const cli = app ? join(app, "Contents/Resources/app/bin/code") : null;
  return cli && existsSync(cli) ? cli : null;
}

/** Opens the folder in the IDE. An IDE that already has it open brings that window forward instead. */
export async function openInIde(id: IdeId, folder: string, isGitRoot: boolean): Promise<ActionResult> {
  const name = ideName(id);
  if (!existsSync(folder)) return { ok: false, message: `That folder is gone: ${folder}` };
  // These IDEs turn the folder into a project and write .idea/ into it; a home or scratch folder must not get one.
  if (ideById(id)?.project && !isGitRoot) return { ok: false, message: `${name} opens a folder as a project, so it opens only git repos. This session is not in one.` };
  return (await openApp(id, [folder])) ? { ok: true, message: `Opened in ${name}` } : { ok: false, message: `${name} was not found on this Mac.` };
}
