import { describe, expect, it } from "vitest";
import { openTarget, targetName } from "../shared/ides.ts";
import { desktopUrl } from "../server/monitor.ts";

describe("Claude desktop app sessions", () => {
  it("links a desktop session to its own session in the app", () => {
    expect(desktopUrl({ entrypoint: "claude-desktop", hostSessionId: "local_b54c4162-24b1-4d58-9e10-0434be916cb0" })).toBe(
      "claude://code/continue?session=local_b54c4162-24b1-4d58-9e10-0434be916cb0",
    );
  });

  it("has no link for a session the app does not run", () => {
    expect(desktopUrl({ entrypoint: "cli", hostSessionId: null })).toBeNull();
    expect(desktopUrl({ entrypoint: "claude-vscode", hostSessionId: "local_abc" })).toBeNull();
  });

  it("never puts an odd id into the link", () => {
    expect(desktopUrl({ entrypoint: "claude-desktop", hostSessionId: "local_x&evil=1" })).toBe("claude://code/continue?session=last");
    expect(desktopUrl({ entrypoint: "claude-desktop", hostSessionId: null })).toBe("claude://code/continue?session=last");
  });

  it("opens in Claude, ahead of an IDE or tmux", () => {
    const t = openTarget({ tmux: null, ide: "pycharm", desktopUrl: "claude://code/continue?session=local_a" }, "vscode");
    expect(t).toEqual({ kind: "desktop" });
    expect(targetName(t)).toBe("Claude");
    expect(openTarget({ tmux: null, ide: "pycharm", desktopUrl: null }, "vscode")).toEqual({ kind: "ide", ide: "pycharm" });
  });
});
