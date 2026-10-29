// The packaged apps with their assets on another origin (support.ts holds the packed
// package and the shared Chrome).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { TEARDOWN_TIMEOUT } from "../../scripts/testing/chrome";
import {
  copyAssets,
  type HostWindow,
  instrument,
  packedPackage,
  SETUP_TIMEOUT,
  serve,
  sharedChrome,
} from "./support";

let temporary = "";
let installed = "";

beforeAll(async () => {
  ({ temporary, installed } = await packedPackage());
}, SETUP_TIMEOUT);

// The packaged apps with their assets on another origin, which serves them with CORS.
describe("the packaged app with its assets on another origin", () => {
  let context: BrowserContext | undefined;
  let page: Page;
  let servers: { stop: (force?: boolean) => Promise<void> }[] = [];

  beforeAll(async () => {
    const assets = join(temporary, "cross-origin-assets");
    const host = join(temporary, "cross-origin-host");
    await copyAssets(join(assets, "dnbm"));
    const assetServer = serve(
      { "/": assets },
      { hostname: "localhost", headers: { "Access-Control-Allow-Origin": "*" } },
    );
    const assetsUrl = new URL("/dnbm/", assetServer.url).href;
    const songs = ["wraith", "undertow"].map(
      (name) => new URL(`songs/${name}.dnbm.json`, assetsUrl).href,
    );
    await mkdir(host, { recursive: true });
    await writeFile(
      join(host, "index.html"),
      `<!doctype html><meta charset="utf-8"><title>host</title>
<div id="window" style="width:1200px;height:800px"></div>
<div id="player" style="width:440px;height:420px"></div>
<script type="module">
  import { mountDnbm, mountDnbmPlayer } from "/lib/index.js";
  mountDnbm(document.getElementById("window"), { assetsUrl: "${assetsUrl}" });
  mountDnbmPlayer(document.getElementById("player"), {
    assetsUrl: "${assetsUrl}",
    songs: ${JSON.stringify(songs)},
  });
</script>`,
    );
    const hostServer = serve({ "/lib/": join(installed, "lib"), "/": host });
    servers = [assetServer, hostServer];
    context = await (await sharedChrome()).newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 1300 },
    });
    page = await context.newPage();
    await page.addInitScript(instrument);
    await page.goto(hostServer.url.href);
    await page.locator("#window .cell").first().waitFor();
    await page.locator("#player .track").first().waitFor();
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    try {
      await context?.close();
    } finally {
      await Promise.all(servers.map((server) => server.stop(true)));
    }
  }, TEARDOWN_TIMEOUT);

  test("plays, and exports a WAV through its worker", async () => {
    const sequencer = page.locator("#window");
    await sequencer.locator(".play").click();
    await sequencer.locator(".cell.now").first().waitFor({ timeout: 10_000 });
    await sequencer.locator(".play").click();
    // A new song is short, so it renders in a moment.
    await sequencer.locator('button:text-is("new")').click();
    await page.waitForFunction(
      () =>
        (window as unknown as HostWindow).shadow("window").querySelector<HTMLInputElement>(".title")
          ?.value === "Untitled",
    );
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      sequencer.locator('button:text-is("export")').click(),
    ]);
    expect(download.suggestedFilename()).toBe("untitled.wav");
  }, 40_000);

  test("lists the host's songs in its order, embedded, filling its container", async () => {
    const player = page.locator("#player");
    expect(await player.locator(".track-title").allTextContents()).toEqual(["Wraith", "Undertow"]);
    expect(await player.locator(".bar").isVisible()).toBe(false);
    const size = await page.evaluate(() => {
      const root = document.querySelector("#player > div")?.shadowRoot;
      const frame = root?.querySelector(".frame");
      const box = root?.querySelector(".player")?.getBoundingClientRect();
      return {
        width: box?.width,
        height: box?.height,
        scrolls: (frame?.scrollHeight ?? 0) > (frame?.clientHeight ?? 0),
      };
    });
    expect(size).toEqual({ width: 440, height: 420, scrolls: false });
  });

  test("plays from a click in the player", async () => {
    const player = page.locator("#player");
    await player.locator(".control.play").click();
    await page.waitForFunction(
      () =>
        (window as unknown as HostWindow).shadow("player").querySelector(".time")?.textContent !==
        "0:00",
      undefined,
      { timeout: 15_000 },
    );
    expect(await player.locator(".player").getAttribute("data-state")).toBe("playing");
    expect(await player.locator(".status").textContent()).toBe("");
  }, 30_000);
});
