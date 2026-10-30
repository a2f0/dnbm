import { expect, test } from "bun:test";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../scripts/build/build";

test("ships identical repo-owned music-fidelity skills for every agent", () => {
  const copies = [".agents", ".claude"].map((agent) => {
    const directory = join(ROOT, agent, "skills/music-fidelity");
    expect(existsSync(directory)).toBe(true);
    const files: Record<string, string> = {};
    for (const entry of readdirSync(directory, { recursive: true, encoding: "utf8" }).sort()) {
      const path = join(directory, entry);
      const stat = lstatSync(path);
      expect(stat.isSymbolicLink()).toBe(false);
      if (stat.isFile()) files[entry] = readFileSync(path, "utf8");
    }
    expect(files["SKILL.md"]).toBeDefined();
    expect(files[join("agents", "openai.yaml")]).toBeDefined();
    return files;
  });
  expect(copies[0]).toEqual(copies[1]);
});

test("fidelity entrypoints and queue are discoverable, not managed tooling copies", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  expect(pkg.scripts["fidelity:capture"]).toBe("bun scripts/fidelity/capture.ts");
  expect(pkg.scripts["fidelity:compare"]).toBe("bun scripts/fidelity/compare.ts");
  expect(existsSync(join(ROOT, "docs/music-fidelity.md"))).toBe(true);
  expect(readFileSync(join(ROOT, "AGENTS.md"), "utf8")).toContain("music-fidelity");
  expect(readFileSync(join(ROOT, ".agent-tool-skills.json"), "utf8")).not.toContain(
    "music-fidelity",
  );
});
