// Names given in Control Room to sessions outside VS Code: they must survive a restart and never mix up sessions.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const home = mkdtempSync(join(tmpdir(), "cr-home-"));
process.env.HOME = home;
const dir = join(home, ".claude-control-room");
const file = join(dir, "names.json");

// A fresh module stands for a fresh start of Control Room: it reads the file again.
const fresh = async () => {
  vi.resetModules();
  return import("../server/names.ts");
};

describe("saved names", () => {
  beforeEach(() => rmSync(file, { force: true }));

  it("keeps a name across a restart, per session", async () => {
    const names = await fresh();
    await names.saveName("aaa", "Dock deletion");
    expect(await names.savedName("aaa")).toBe("Dock deletion");
    expect(await names.savedName("bbb")).toBeNull();
    const again = await fresh();
    expect(await again.savedName("aaa")).toBe("Dock deletion");
  });

  it("keeps both names when two renames come at once", async () => {
    const names = await fresh();
    await Promise.all([names.saveName("aaa", "One"), names.saveName("bbb", "Two")]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ aaa: "One", bbb: "Two" });
  });

  it("forgets a name, and keeps only the newest 500", async () => {
    const names = await fresh();
    await names.saveName("aaa", "One");
    await names.saveName("aaa", null);
    expect(await names.savedName("aaa")).toBeNull();
    for (let i = 0; i < 502; i++) await names.saveName(`s${i}`, `Name ${i}`);
    const kept = Object.keys(JSON.parse(readFileSync(file, "utf8")));
    expect(kept.length).toBe(500);
    expect(kept[0]).toBe("s2");
  });

  it("starts empty without a file, and never writes over a file it cannot read", async () => {
    expect(await (await fresh()).savedName("aaa")).toBeNull();
    mkdirSync(dir, { recursive: true });
    for (const content of ["not json", "[1,2]", "null"]) {
      writeFileSync(file, content);
      const names = await fresh();
      expect(await names.savedName("aaa")).toBeNull();
      await expect(names.saveName("bbb", "Two")).rejects.toThrow();
      expect(readFileSync(file, "utf8")).toBe(content);
    }
    writeFileSync(file, '{"aaa": 7}');
    expect(await (await fresh()).savedName("aaa")).toBeNull();
  });

  it("shows a name only once it is on disk", async () => {
    mkdirSync(join(dir, "names.json.tmp"), { recursive: true }); // makes the write fail
    const names = await fresh();
    await expect(names.saveName("aaa", "One")).rejects.toThrow();
    expect(await names.savedName("aaa")).toBeNull();
    rmSync(join(dir, "names.json.tmp"), { recursive: true });
  });
});
