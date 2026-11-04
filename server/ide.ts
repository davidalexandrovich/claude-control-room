import { existsSync } from "node:fs";
import { join } from "node:path";
import { IDES, ideName, type IdeId } from "../shared/ides.ts";
import type { ActionResult } from "../shared/types.ts";
import { HOME } from "./paths.ts";
import { launch } from "./proc.ts";

function appPath(id: IdeId): string | null {
  const apps = IDES.find((i) => i.id === id)?.apps ?? [];
  for (const dir of ["/Applications", join(HOME, "Applications")]) {
    for (const app of apps) if (existsSync(join(dir, app))) return join(dir, app);
  }
  return null;
}

export function installedIdes(): IdeId[] {
  return IDES.filter((i) => appPath(i.id) !== null).map((i) => i.id);
}

export function ideOf(comm: string): IdeId | null {
  return IDES.find((i) => i.process.test(comm))?.id ?? null;
}

/** Opens the folder in the IDE. An IDE that already has it open brings that window forward instead. */
export function openInIde(id: IdeId, folder: string): ActionResult {
  const app = appPath(id);
  if (!app) return { ok: false, message: `${ideName(id)} was not found in Applications.` };
  launch("open", ["-a", app, folder]);
  return { ok: true, message: `Opened in ${ideName(id)}` };
}
