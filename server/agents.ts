// Which coding agents besides Claude Code are on this Mac, for New session to offer.
import { allAgents, type AgentTool } from "../shared/agents.ts";
import type { AgentChoice } from "../shared/types.ts";
import { settings } from "./config.ts";
import { run } from "./proc.ts";

const found = new Map<string, { at: number; ok: boolean }>();

/** Whether a program is on the PATH your terminal has (nvm's and ~/.local/bin too); looked up once a minute at most. */
async function onPath(bin: string): Promise<boolean> {
  const hit = found.get(bin);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  const ok = !!bin && (await run("/bin/sh", ["-c", 'command -v "$1"', "sh", bin], { timeoutMs: 3_000 })).ok;
  found.set(bin, { at: Date.now(), ok });
  return ok;
}

export async function agentChoices(): Promise<AgentChoice[]> {
  return Promise.all(allAgents(settings().agents).map(async (t) => ({ id: t.id, label: t.label, installed: await onPath(t.bin), takesPrompt: t.takesPrompt })));
}

export function agentTool(id: unknown): AgentTool | null {
  return allAgents(settings().agents).find((t) => t.id === id) ?? null;
}
