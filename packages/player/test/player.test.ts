// The player in a real browser: it lists the example songs, plays one through the
// AudioWorklet, and fits a phone's width. Needs Google Chrome, like the layout suite.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { newSong } from "@a2f0/dnbm-synth/song/defaults";
import { serializeSong } from "@a2f0/dnbm-synth/song/format";
import { type Browser, chromium, type Page } from "playwright-core";
import { build, DIST, ROOT } from "../../../scripts/build";
import { clock, timeline } from "../src/timeline";

const SONG_COUNT = readdirSync(join(ROOT, "songs")).filter((file) =>
  file.endsWith(".dnbm.json"),
).length;

/** Short songs, so a test hears one end: the default song's single two-bar pattern. */
const SHORT = newSong();
const SHORT_SONGS: Record<string, string> = {
  "/test-songs/one.dnbm.json": serializeSong({ ...SHORT, title: "One" }),
  "/test-songs/two.dnbm.json": serializeSong({ ...SHORT, title: "Two" }),
};

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  await build();
  server = Bun.serve({
    hostname: "localhost",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      const song = SHORT_SONGS[path];
      if (song) return new Response(song);
      const file = Bun.file(join(DIST, path.endsWith("/") ? `${path}index.html` : path));
      return file.size > 0 ? new Response(file) : new Response("Not found", { status: 404 });
    },
  });
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
});

async function state(page: Page): Promise<string | null> {
  return page.locator(".player").getAttribute("data-state");
}

describe("player", () => {
  test("lists every example song and plays one", async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(new URL("/player/", server.url).href);
      await page.waitForSelector(".track");
      expect(await page.locator(".track").count()).toBe(SONG_COUNT);
      expect(await page.locator(".time").textContent()).toBe("0:00");

      await page.locator(".track").nth(1).click();
      await page.waitForFunction(() => document.querySelector(".time")?.textContent !== "0:00", {
        timeout: 15_000,
      });
      expect(await page.locator(".player").getAttribute("data-state")).toBe("playing");
      expect(await page.locator(".track").nth(1).getAttribute("aria-current")).toBe("true");

      await page.keyboard.press("c");
      expect(await page.locator(".player").getAttribute("data-state")).toBe("paused");
      await page.keyboard.press("v");
      expect(await page.locator(".player").getAttribute("data-state")).toBe("stopped");
      expect(await page.locator(".time").textContent()).toBe("0:00");

      await page.keyboard.press("b");
      expect(await page.locator(".track").nth(2).getAttribute("aria-current")).toBe("true");
      expect(errors).toEqual([]);
      expect(await page.locator(".status").textContent()).toBe("");
    } finally {
      await page.close();
    }
  }, 30_000);

  test("fits a phone's width", async () => {
    const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
    try {
      await page.goto(new URL("/player/", server.url).href);
      await page.waitForSelector(".track");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    } finally {
      await page.close();
    }
  });

  test("plays a song once, and holds its tail through a pause before the next", async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    try {
      const songs = Object.keys(SHORT_SONGS).map((path) => `song=${path}`);
      await page.goto(new URL(`/player/?${songs.join("&")}`, server.url).href);
      await page.waitForSelector(".track");
      expect(await page.locator(".track-title").allTextContents()).toEqual(["One", "Two"]);
      await page.locator(".control.play").click();
      // The engine stops itself at the end of the song, and the tail starts.
      await page.waitForSelector(".player[data-ending]", { timeout: 15_000 });
      expect(await page.locator(".time").textContent()).toBe(clock(timeline(SHORT).seconds));

      await page.keyboard.press("c");
      await page.waitForTimeout(2_500);
      expect(await state(page)).toBe("paused");
      expect(await page.locator(".track").nth(0).getAttribute("aria-current")).toBe("true");

      await page.keyboard.press("c");
      await page.waitForSelector('.track[data-index="1"][aria-current]', { timeout: 5_000 });
      expect(await state(page)).toBe("playing");
    } finally {
      await page.close();
    }
  }, 40_000);

  test("a pause while the engine starts holds, and play then starts the song", async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    const { promise: release, resolve } = Promise.withResolvers<void>();
    await page.route("**/engine.wasm", async (route) => {
      await release;
      await route.continue();
    });
    try {
      await page.goto(new URL("/player/", server.url).href);
      await page.waitForSelector(".track");
      await page.locator(".control.play").click();
      await page.keyboard.press("c");
      expect(await state(page)).toBe("paused");
      resolve();
      await page.waitForTimeout(1_500);
      expect(await state(page)).toBe("paused");
      expect(await page.locator(".time").textContent()).toBe("0:00");

      await page.keyboard.press("x");
      await page.waitForFunction(() => document.querySelector(".time")?.textContent !== "0:00", {
        timeout: 15_000,
      });
      expect(await state(page)).toBe("playing");
    } finally {
      await page.close();
    }
  }, 30_000);
});
