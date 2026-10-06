// dnbm is drawn in greys: every colour the repository writes, in its pages, styles,
// scripts and tests, has equal red, green and blue. Adapted from a2f0/skyline. This
// file's samples are colours on purpose, and the lockfile's hashes aren't colours.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..");
const exempt = new Set(["bun.lock", "web/test/grayscale.test.ts", "engine/Cargo.lock"]);
const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(
    (file) =>
      file && !exempt.has(file) && !file.startsWith(".agents/") && !file.startsWith(".claude/"),
  );

const properties =
  "color|background(?:-color)?|border(?:-[a-z]+)?|outline(?:-color)?|fill|stroke|stop-color|accent-color|caret-color|box-shadow|text-shadow|fillStyle|strokeStyle|shadowColor";
const notations: [RegExp, (match: RegExpExecArray) => string[]][] = [
  [/(?<![\w(&])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi, (m) => [m[0]]],
  [/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^)]*\)/gi, (m) => [m[0]]],
  [
    new RegExp(`(?<![\\w-])(?:${properties})\\s*[:=]\\s*["'\`]?([^;"'\`}\\n]+)`, "gi"),
    (m) => (m[1] ?? "").split(/[^a-z]+/i).filter((word) => /^[a-z]{3,}$/i.test(word)),
  ],
];

function colours(text: string): { colour: string; line: number }[] {
  const found: { colour: string; line: number }[] = [];
  for (const [pattern, read] of notations) {
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      for (const value of read(match)) {
        const channels = Bun.color(value, "[rgb]");
        // Words a colour property holds that name no colour, like "solid" or "inherit".
        if (!Array.isArray(channels)) continue;
        const [r, g, b] = channels;
        if (r !== g || g !== b) {
          found.push({ colour: value, line: text.slice(0, match.index).split("\n").length });
        }
      }
    }
  }
  return found;
}

describe("grayscale", () => {
  test("every colour in the repository is a grey", () => {
    const coloured = files.flatMap((file) => {
      const bytes = readFileSync(path.join(root, file));
      if (bytes.includes(0)) return [];
      return colours(bytes.toString("utf8")).map(({ colour, line }) => `${file}:${line} ${colour}`);
    });
    expect(coloured).toEqual([]);
  });

  test("finds a colour in each notation, and passes greys", () => {
    const samples = [
      ".a { color: #a2b5b8; }",
      "rgba(10, 20, 30, 0.5)",
      ".b { border: 1px solid steelblue; }",
      'context.strokeStyle = "red"',
    ];
    expect(samples.filter((sample) => colours(sample).length !== 1)).toEqual([]);
    const greys = [
      ".a { color: #ddd; background: #080808cc; }",
      "rgba(194, 194, 194, 0.72)",
      "fix: change (#123)",
      ".b { fill: currentColor; }",
    ];
    expect(greys.filter((sample) => colours(sample).length)).toEqual([]);
  });
});
