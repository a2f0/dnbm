// The player in a real browser: it lists the example songs, plays one through the
// AudioWorklet, and fits a phone's width. Needs Google Chrome, like the layout suite.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlayingPosition } from "@a2f0/dnbm-synth/audio/engineHost";
import { newSong } from "@a2f0/dnbm-synth/song/defaults";
import { parseSong, serializeSong } from "@a2f0/dnbm-synth/song/format";
import type { Browser, Page } from "playwright-core";
import { build, DIST, ROOT } from "../../../scripts/build/build";
import { closeChrome, launchChrome, TEARDOWN_TIMEOUT } from "../../../scripts/testing/chrome";
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
  browser = await launchChrome({ args: ["--autoplay-policy=no-user-gesture-required"] });
}, 120_000);

afterAll(async () => {
  try {
    await closeChrome(browser);
  } finally {
    await server?.stop(true);
  }
}, TEARDOWN_TIMEOUT);

async function state(page: Page): Promise<string | null> {
  return page.locator(".player").getAttribute("data-state");
}

/** Waits until the display's clock leaves 0:00. */
async function untilPlaying(page: Page): Promise<void> {
  const time = await page.waitForSelector(".time");
  await page.waitForFunction((element) => element.textContent !== "0:00", time, {
    timeout: 15_000,
  });
}

interface AudioProbe {
  contexts: AudioContext[];
  nodes: AudioWorkletNode[];
  resumes: number;
  positions: PlayingPosition[];
}

/** Observe the real engine without replacing its transport or clock. */
async function observeAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = window as unknown as AudioProbe;
    probe.contexts = [];
    probe.nodes = [];
    probe.resumes = 0;
    probe.positions = [];
    const NativeContext = AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.contexts.push(this);
      }
      override resume(): Promise<void> {
        probe.resumes++;
        return super.resume();
      }
    };
    const NativeNode = AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeNode {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        probe.nodes.push(this);
        this.port.addEventListener("message", (event: MessageEvent) => {
          if (event.data.type === "position") probe.positions.push(event.data);
        });
      }
    };
  });
}

function audio(page: Page) {
  return page.evaluate(() => {
    const probe = window as unknown as AudioProbe;
    return {
      contexts: probe.contexts.map((context) => ({
        state: context.state,
        time: context.currentTime,
      })),
      resumes: probe.resumes,
    };
  });
}

async function seek(page: Page, seconds: number): Promise<void> {
  await page.locator(".seek").evaluate((element: HTMLInputElement, seconds) => {
    element.value = String(seconds);
    element.dispatchEvent(new Event("input"));
    element.dispatchEvent(new Event("change"));
  }, seconds);
}

/** A negative window: neither the engine clock nor the selected position may advance. */
async function staysPaused(page: Page): Promise<void> {
  expect(await state(page)).toBe("paused");
  const before = await audio(page);
  expect(before.contexts.map((context) => context.state)).toEqual(["suspended"]);
  const position = await page.locator(".seek").inputValue();
  await page.waitForTimeout(1_700);
  expect(await audio(page)).toEqual(before);
  expect(await state(page)).toBe("paused");
  expect(await page.locator(".seek").inputValue()).toBe(position);
}

async function pause(page: Page): Promise<void> {
  await page.locator(".control.pause").click();
  await page.waitForFunction(
    () => (window as unknown as AudioProbe).contexts[0]?.state === "suspended",
  );
}

function songLine(name: string) {
  return timeline(
    parseSong(JSON.parse(readFileSync(join(ROOT, "songs", `${name}.dnbm.json`), "utf8"))),
  );
}

describe("player", () => {
  test("paused seeks hold the final requested slot until explicit play", async () => {
    const page = await browser.newPage();
    await observeAudio(page);
    try {
      await page.goto(new URL("/player/", server.url).href);
      await page.locator(".control.play").click();
      await untilPlaying(page);
      await pause(page);
      const before = await audio(page);
      const line = songLine("bathyal");
      const seconds = (line.slotSteps[3] ?? 0) * line.stepSeconds;
      await seek(page, 30);
      await seek(page, seconds);
      expect(await audio(page)).toEqual(before);
      expect(Number(await page.locator(".seek").inputValue())).toBeCloseTo(seconds);
      await staysPaused(page);
      await page.evaluate(() => {
        (window as unknown as AudioProbe).positions = [];
      });
      await page.locator(".control.play").click();
      await page.waitForFunction(() =>
        (window as unknown as AudioProbe).positions.some(
          (position) => position.playing && position.slot === 3,
        ),
      );
      const position = await page.locator(".seek").elementHandle();
      await page.waitForFunction(
        ({ element, seconds }) => Number((element as HTMLInputElement).value) > seconds,
        {
          element: position,
          seconds,
        },
      );
      expect(await state(page)).toBe("playing");
    } finally {
      await page.close();
    }
  }, 30_000);

  test("paused next and previous queue songs without resuming the old engine", async () => {
    const page = await browser.newPage();
    await observeAudio(page);
    try {
      await page.goto(new URL("/player/", server.url).href);
      await page.locator(".control.play").click();
      await untilPlaying(page);
      await pause(page);
      const before = await audio(page);
      await page.locator(".control.next").click();
      expect(await state(page)).toBe("paused");
      expect(await page.locator(".track.current .track-title").textContent()).toBe("Blackwater");
      expect(await page.locator(".time").textContent()).toBe("0:00");
      await seek(page, 30);
      // Past three seconds, previous restarts this song; a second press goes back.
      await page.locator(".control.previous").click();
      expect(await page.locator(".track.current .track-title").textContent()).toBe("Blackwater");
      expect(await page.locator(".time").textContent()).toBe("0:00");
      await page.keyboard.press("z");
      expect(await page.locator(".track.current .track-title").textContent()).toBe("Bathyal");
      await page.keyboard.press("b");
      const line = songLine("blackwater");
      const seconds = (line.slotSteps[2] ?? 0) * line.stepSeconds;
      await seek(page, seconds);
      // Messages already in flight from the old song must not move the queued display
      // or start its tail. The actual worklet remains suspended throughout.
      await page.evaluate(() => {
        const port = (window as unknown as AudioProbe).nodes[0]?.port;
        for (const playing of [true, false]) {
          port?.dispatchEvent(
            new MessageEvent("message", {
              data: { type: "position", playing, slot: 0, pattern: 0, step: 5 },
            }),
          );
        }
      });
      expect(Number(await page.locator(".seek").inputValue())).toBeCloseTo(seconds);
      expect(await page.locator(".player[data-ending]").count()).toBe(0);
      expect(await audio(page)).toEqual(before);
      await staysPaused(page);
      await page.evaluate(() => {
        (window as unknown as AudioProbe).positions = [];
      });
      await page.locator(".control.pause").click();
      await page.waitForFunction(() =>
        (window as unknown as AudioProbe).positions.some(
          (position) => position.playing && position.slot === 2,
        ),
      );
      expect(await state(page)).toBe("playing");
      expect(Number(await page.locator(".seek").inputValue())).toBeGreaterThanOrEqual(
        seconds - 0.001,
      );
      expect(await page.locator(".track.current .track-title").textContent()).toBe("Blackwater");
      await page.locator(".control.next").click();
      expect(await state(page)).toBe("playing");
      expect(await page.locator(".track.current .track-title").textContent()).toBe("Catacomb");
      await pause(page);
      await page.locator(".track").first().click();
      await untilPlaying(page);
      expect(await state(page)).toBe("playing");
      expect(await page.locator(".track.current .track-title").textContent()).toBe("Bathyal");
    } finally {
      await page.close();
    }
  }, 30_000);

  test("early resume consumes the latest startup seek only once", async () => {
    const page = await browser.newPage();
    await observeAudio(page);
    const { promise: release, resolve } = Promise.withResolvers<void>();
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    await page.route("**/engine.wasm", async (route) => {
      enter();
      await release;
      await route.continue();
    });
    try {
      await page.goto(new URL("/player/", server.url).href);
      await page.locator(".control.play").click();
      await entered;
      await page.locator(".control.pause").click();
      await page.locator(".control.next").click();
      const line = songLine("blackwater");
      await seek(page, (line.slotSteps[2] ?? 0) * line.stepSeconds);
      await page.locator(".control.play").click();
      const seconds = (line.slotSteps[3] ?? 0) * line.stepSeconds;
      await seek(page, seconds);
      resolve();
      await page.waitForFunction(() =>
        (window as unknown as AudioProbe).positions.some((position) => position.playing),
      );
      expect(
        await page.evaluate(
          () =>
            (window as unknown as AudioProbe).positions.find((position) => position.playing)?.slot,
        ),
      ).toBe(3);
      expect((await audio(page)).resumes).toBe(1);
      expect(Number(await page.locator(".seek").inputValue())).toBeGreaterThanOrEqual(
        seconds - 0.001,
      );
      expect(await page.locator(".track.current .track-title").textContent()).toBe("Blackwater");
    } finally {
      resolve();
      await page.close();
    }
  }, 30_000);

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
      await untilPlaying(page);
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
      expect(
        await page.evaluate(() => {
          const frame = document.querySelector("#app > div")?.shadowRoot?.querySelector(".frame");
          return (
            document.documentElement.scrollWidth > innerWidth ||
            (frame?.scrollWidth ?? 0) > (frame?.clientWidth ?? 0)
          );
        }),
      ).toBe(false);
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

  test.each(["seek", "next", "previous"])(
    "paused tail navigation by %s cancels the old tail",
    async (action) => {
      const page = await browser.newPage();
      await observeAudio(page);
      try {
        const songs = Object.keys(SHORT_SONGS).map((path) => `song=${path}`);
        await page.goto(new URL(`/player/?${songs.join("&")}`, server.url).href);
        await page.locator(".control.play").click();
        await page.waitForSelector(".player[data-ending]", { timeout: 15_000 });
        await pause(page);
        const before = await audio(page);
        if (action === "seek") await seek(page, 0);
        else await page.locator(`.control.${action}`).click();
        // This fixture ends before the three-second restart threshold, so previous
        // wraps to Two just like next; the long-song test covers restarting in place.
        const title = action === "seek" ? "One" : "Two";
        expect(await page.locator(".track.current .track-title").textContent()).toBe(title);
        expect(await page.locator(".player[data-ending]").count()).toBe(0);
        expect(await page.locator(".time").textContent()).toBe("0:00");
        expect(await audio(page)).toEqual(before);
        await staysPaused(page);
        await page.locator(".control.pause").click();
        await untilPlaying(page);
        expect(await page.locator(".track.current .track-title").textContent()).toBe(title);
        expect(await state(page)).toBe("playing");
      } finally {
        await page.close();
      }
    },
    30_000,
  );

  test("paused navigation during engine startup retains the last song and slot", async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    await observeAudio(page);
    const { promise: release, resolve } = Promise.withResolvers<void>();
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    await page.route("**/engine.wasm", async (route) => {
      enter();
      await release;
      await route.continue();
    });
    try {
      await page.goto(new URL("/player/", server.url).href);
      await page.waitForSelector(".track");
      await page.locator(".control.play").click();
      await entered;
      await page.keyboard.press("c");
      await page.keyboard.press("b");
      const line = songLine("blackwater");
      const seconds = (line.slotSteps[2] ?? 0) * line.stepSeconds;
      await seek(page, 30);
      await seek(page, seconds);
      expect(await state(page)).toBe("paused");
      resolve();
      await page.waitForFunction(() => (window as unknown as AudioProbe).nodes.length === 1);
      await page.waitForTimeout(1_500);
      await staysPaused(page);
      expect(await page.locator(".track.current .track-title").textContent()).toBe("Blackwater");
      expect(Number(await page.locator(".seek").inputValue())).toBeCloseTo(seconds);

      await page.locator(".control.play").click();
      await page.waitForFunction(() =>
        (window as unknown as AudioProbe).positions.some(
          (position) => position.playing && position.slot === 2,
        ),
      );
      expect(await state(page)).toBe("playing");
      expect(Number(await page.locator(".seek").inputValue())).toBeGreaterThanOrEqual(
        seconds - 0.001,
      );
    } finally {
      resolve();
      await page.close();
    }
  }, 30_000);
});
