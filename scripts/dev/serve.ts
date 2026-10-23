// Serves dist/ on localhost and rebuilds when sources change: the engine when
// packages/synth/engine/ changes, the pages otherwise (including the shell in src/,
// which both pages' scripts bundle, and the favicons' sources in assets/brand/).
// Responses carry the production headers from packages/sequencer/_headers, so the
// content security policy is exercised locally too, and a missing path gets the site's
// 404 page with status 404, as Cloudflare answers it.
// AudioWorklet needs a secure context: localhost is one, file:// pages are not.

import { watch } from "node:fs";
import { extname, join, normalize } from "node:path";
import { build, buildEngine, buildWeb, DIST, NOT_FOUND_PAGE, ROOT } from "../build/build";

const port = Number(process.env["PORT"] ?? 8174);
// Only the production build copies it into dist/, so serve it from its source.
const NOT_FOUND = join(ROOT, "packages", "sequencer", NOT_FOUND_PAGE);

/** The headers packages/sequencer/_headers sets for every path ("/*"). */
async function siteHeaders(): Promise<Record<string, string>> {
  const text = await Bun.file(join(ROOT, "packages", "sequencer", "_headers")).text();
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s+([\w-]+):\s*(.+)$/.exec(line);
    if (match?.[1] && match[2]) headers[match[1]] = match[2];
  }
  return headers;
}

await build(false);
let headers = await siteHeaders();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    // URL parsing resolves "..", and normalize keeps the path inside dist.
    const path = normalize(new URL(request.url).pathname);
    const name = path.endsWith("/")
      ? `${path}index.html`
      : extname(path) === ""
        ? `${path}.html`
        : path;
    const file = Bun.file(join(DIST, name));
    return (await file.exists())
      ? new Response(file, { headers })
      : new Response(Bun.file(NOT_FOUND), {
          status: 404,
          headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
        });
  },
});

let pending: ReturnType<typeof setTimeout> | undefined;
let engineChanged = false;
function rebuild(engine: boolean): void {
  engineChanged ||= engine;
  clearTimeout(pending);
  pending = setTimeout(async () => {
    const withEngine = engineChanged;
    engineChanged = false;
    try {
      if (withEngine) await buildEngine();
      await buildWeb(false);
      headers = await siteHeaders();
      console.info(`Rebuilt${withEngine ? " engine and" : ""} page; reload to hear it.`);
    } catch (error) {
      console.error(error);
    }
  }, 150);
}

const ENGINE = join("synth", "engine");
watch(join(ROOT, "packages"), { recursive: true }, (_event, file) => {
  // Cargo writes its build output under the engine; only sources trigger a rebuild.
  if (!file || file.split(/[\\/]/).includes("target") || file.includes("node_modules")) return;
  rebuild(file.startsWith(ENGINE));
});
watch(join(ROOT, "songs"), { recursive: true }, () => rebuild(false));
watch(join(ROOT, "src"), { recursive: true }, () => rebuild(false));
watch(join(ROOT, "assets"), { recursive: true }, () => rebuild(false));

console.info(`dnbm: http://localhost:${server.port}`);
console.info(`player: http://localhost:${server.port}/player/`);
