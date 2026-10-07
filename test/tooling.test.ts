import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Exercise Miniflare's own Sharp resolution under Wrangler's actual Node runtime.
// This protects the security patch override with a local native/runtime check.
test("Wrangler's local Images binding decodes SVG and transforms it through Sharp", () => {
  const result = execFileSync(
    "node",
    [
      "--input-type=module",
      "--eval",
      `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    const require = createRequire(process.cwd() + "/package.json");
    const wrangler = createRequire(require.resolve("wrangler/package.json"));
    const miniflare = createRequire(wrangler.resolve("miniflare"));
    const { Miniflare } = wrangler("miniflare");
    const sharp = miniflare("sharp");
    const mf = new Miniflare({
      cf: false,
      telemetry: { enabled: false },
      workers: [{ config: {
        name: "dnbm-image-runtime-test",
        compatibilityDate: "2026-10-06",
        env: { IMAGES: { type: "images", dev: { remote: false } } },
        manifest: { mainModule: "index.js", modules: {
          "index.js": { type: "esm", contents: \`export default {
            async fetch(request, env) {
              return (await env.IMAGES.input(request.body)
                .transform({ width: 8, height: 6 })
                .output({ format: "image/png" })).response();
            }
          };\` }
        } }
      } }]
    });
    try {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="#808080"/></svg>';
      const response = await mf.dispatchFetch("http://localhost/image", {
        method: "POST", body: svg
      });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get("content-type"), "image/png");
      const image = sharp(Buffer.from(await response.arrayBuffer()));
      const metadata = await image.metadata();
      assert.equal(metadata.width, 8);
      assert.equal(metadata.height, 6);
      const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.channels, 3);
      assert.ok([...data].every(channel => channel === 128));
      console.log(JSON.stringify({ width: metadata.width, height: metadata.height, channels: info.channels }));
    } finally {
      await mf.dispose();
    }
  `,
    ],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  expect(JSON.parse(result.trim())).toEqual({ width: 8, height: 6, channels: 3 });
}, 35_000);
