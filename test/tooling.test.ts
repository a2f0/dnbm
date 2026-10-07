import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

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
