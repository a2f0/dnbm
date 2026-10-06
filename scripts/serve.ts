// Serves dist/ on localhost and rebuilds when sources change: the engine when engine/
// changes, the page otherwise. Responses carry the production headers from
// web/_headers, so the content security policy is exercised locally too.
// AudioWorklet needs a secure context: localhost is one, file:// pages are not.

import { watch } from "node:fs";
import { extname, join, normalize } from "node:path";
import { build, buildEngine, buildWeb, DIST, ROOT } from "./build";

const port = Number(process.env["PORT"] ?? 8174);

/** The headers web/_headers sets for every path ("/*"). */
async function siteHeaders(): Promise<Record<string, string>> {
  const text = await Bun.file(join(ROOT, "web", "_headers")).text();
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s+([\w-]+):\s*(.+)$/.exec(line);
    if (match?.[1] && match[2]) headers[match[1]] = match[2];
  }
  return headers;
}

await build();
let headers = await siteHeaders();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    // URL parsing resolves "..", and normalize keeps the path inside dist.
    const path = normalize(new URL(request.url).pathname);
    const name = path === "/" ? "index.html" : extname(path) === "" ? `${path}.html` : path;
    const file = Bun.file(join(DIST, name));
    return (await file.exists())
      ? new Response(file, { headers })
      : new Response("Not found", { status: 404, headers });
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
      await buildWeb();
      headers = await siteHeaders();
      console.info(`Rebuilt${withEngine ? " engine and" : ""} page; reload to hear it.`);
    } catch (error) {
      console.error(error);
    }
  }, 150);
}

watch(join(ROOT, "web"), { recursive: true }, () => rebuild(false));
watch(join(ROOT, "songs"), { recursive: true }, () => rebuild(false));
watch(join(ROOT, "engine", "src"), { recursive: true }, () => rebuild(true));

console.info(`dnbm: http://localhost:${server.port}`);
