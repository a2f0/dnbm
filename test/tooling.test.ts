import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

// Check native API compatibility through Miniflare's actual Sharp resolution.
// Advisory audits separately verify that the selected version includes the fix.
test("Wrangler's local Images binding decodes SVG and transforms it through Sharp", () => {
  const result = execFileSync("node", [join(import.meta.dir, "fixtures", "tooling-images.mjs")], {
    cwd: join(import.meta.dir, ".."),
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(JSON.parse(result.trim())).toEqual({ width: 8, height: 6, channels: 3 });
}, 35_000);

test("shell lint scans this checkout when launched from a different repository", () => {
  const caller = realpathSync(mkdtempSync(join(tmpdir(), "lint caller ")));
  const root = realpathSync(join(import.meta.dir, ".."));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  env["PATH"] = caller + ":" + process.env["PATH"];
  try {
    execFileSync("git", ["init", "--quiet", caller], { env });
    writeFileSync(join(caller, "shellcheck"), '#!/bin/sh\npwd -P\nprintf "%s\\n" "$@"\n', {
      mode: 0o755,
    });
    for (const cwd of [root, caller]) {
      const output = execFileSync(
        "sh",
        [relative(cwd, join(root, "scripts/checks/lintScripts.sh"))],
        {
          cwd,
          env,
          encoding: "utf8",
        },
      ).split("\n");
      expect(output).toContain(root);
      expect(output).toContain("scripts/checks/lintScripts.sh");
    }
  } finally {
    rmSync(caller, { recursive: true, force: true });
  }
});
