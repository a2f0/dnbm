// The packaged apps' lifecycle in a host page: remounting, and the host destroying an app
// at any moment, while it saves, opens, starts audio or exports, leaves nothing behind.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright-core";
import { TEARDOWN_TIMEOUT } from "../../scripts/testing/chrome";
import {
  type HostPage,
  type HostWindow,
  instrument,
  openHostPage,
  packedPackage,
  SETUP_TIMEOUT,
} from "./support";

let installed = "";

beforeAll(async () => {
  ({ installed } = await packedPackage());
}, SETUP_TIMEOUT);

describe("the packaged app's lifecycle in a host page", () => {
  let host: HostPage;
  let page: Page;
  let sequencer: Locator;
  let player: Locator;
  const errors: string[] = [];

  /** The number of listeners on the host's window, by event type. */
  async function windowListeners(): Promise<Record<string, number>> {
    const session = await page.context().newCDPSession(page);
    try {
      const { result } = await session.send("Runtime.evaluate", { expression: "window" });
      const { listeners } = await session.send("DOMDebugger.getEventListeners", {
        objectId: result.objectId ?? "",
      });
      const counts: Record<string, number> = {};
      for (const { type } of listeners) counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    } finally {
      await session.detach();
    }
  }

  beforeAll(async () => {
    host = await openHostPage(errors);
    ({ page } = host);
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    sequencer = page.locator("#window");
    player = page.locator("#player");
  }, SETUP_TIMEOUT);

  afterAll(() => host?.close(), TEARDOWN_TIMEOUT);

  test("keeps an edit made just before the host destroys and remounts the app", async () => {
    await sequencer.locator(".title").fill("Night Bus");
    // Commit the edit, then destroy and remount at once: milliseconds, not the
    // hundreds a delayed autosave would need.
    await sequencer.locator(".title").evaluate((title) => title.dispatchEvent(new Event("change")));
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    expect(await sequencer.locator(".title").inputValue()).toBe("Night Bus");
  }, 20_000);

  test("opens the song autosaved under the keys earlier versions used", async () => {
    const song = (
      await readFile(join(installed, "site", "songs", "wraith.dnbm.json"), "utf8")
    ).replace(/"title": "[^"]*"/, '"title": "Saved Before"');
    expect(
      JSON.parse(await page.evaluate(() => localStorage.getItem("dnbm:song") ?? "{}")) as {
        title?: string;
      },
    ).toMatchObject({ title: "Night Bus" });
    await page.evaluate((text) => {
      localStorage.setItem("dnbm:song", text);
      localStorage.setItem("dnbm:saved", text);
    }, song);
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    expect(await sequencer.locator(".title").inputValue()).toBe("Saved Before");
    expect(await sequencer.locator(".status-file").textContent()).not.toContain("●");
  }, 20_000);

  test("a file picked after the host destroys the app opens nothing", async () => {
    // The song is clean, so open asks for a file at once; the host then remounts.
    const chooser = page.waitForEvent("filechooser");
    await sequencer.locator('.files button:text-is("open")').click();
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    const song = await readFile(join(installed, "site", "songs", "undertow.dnbm.json"));
    await (await chooser).setFiles({
      name: "undertow.dnbm.json",
      mimeType: "application/json",
      buffer: song,
    });
    await page.waitForTimeout(500);
    expect(await sequencer.locator(".title").inputValue()).toBe("Saved Before");
    expect(
      JSON.parse(await page.evaluate(() => localStorage.getItem("dnbm:song") ?? "{}")) as {
        title?: string;
      },
    ).toMatchObject({ title: "Saved Before" });
  }, 20_000);

  test("a file chosen in Save As after the host destroys the app is never written", async () => {
    // A picker the page can answer later, as a user would, writing to a file it records.
    await page.evaluate(() => {
      const host = window as unknown as HostWindow & {
        answerPicker?: () => void;
        written?: string[];
      };
      host.written = [];
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: () =>
          new Promise((resolve) => {
            host.answerPicker = () =>
              resolve({
                name: "chosen.dnbm.json",
                createWritable: async () => ({
                  write: async (text: string) => host.written?.push(text),
                  close: async () => {},
                  abort: async () => {},
                }),
              });
          }),
      });
    });
    try {
      await sequencer.locator('.files button:text-is("save")').click();
      await page.waitForFunction(
        () => (window as unknown as { answerPicker?: unknown }).answerPicker !== undefined,
      );
      await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
      await page.evaluate(() => (window as unknown as { answerPicker(): void }).answerPicker());
      await page.waitForTimeout(300);
      expect(
        await page.evaluate(() => (window as unknown as { written: string[] }).written),
      ).toEqual([]);
    } finally {
      await page.evaluate(() =>
        Object.defineProperty(window, "showSaveFilePicker", {
          configurable: true,
          value: undefined,
        }),
      );
    }
  }, 20_000);

  test("a play or preview pressed as the host destroys the apps touches no closed audio", async () => {
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    await page.evaluate(() => (window as unknown as HostWindow).mountPlayer());
    // Start both engines, then stop.
    await sequencer.locator(".play").click();
    await sequencer.locator(".cell.now").first().waitFor({ timeout: 10_000 });
    await sequencer.locator(".play").click();
    await player.locator(".control.play").click();
    await player.locator('.player[data-state="playing"]').waitFor();
    await player.locator(".control.stop").click();
    const late = await page.evaluate(async () => {
      const host = window as unknown as HostWindow;
      const before = host.resumedClosed;
      // Each press awaits the started engine, and the host destroys the apps before
      // that await resumes.
      host.shadow("window").querySelector<HTMLButtonElement>(".play")?.click();
      host.shadow("window").querySelector<HTMLButtonElement>(".track-name")?.click();
      host.shadow("player").querySelector<HTMLButtonElement>(".control.play")?.click();
      host.sequencerApp?.destroy();
      host.playerApp?.destroy();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return host.resumedClosed - before;
    });
    expect(late).toBe(0);
    expect(errors).toEqual([]);
  }, 30_000);

  test("a save the host's destroy interrupts leaves the file as it was", async () => {
    // A picker answered at once, writing to a file whose write finishes when the test says.
    await page.evaluate(() => {
      const host = window as unknown as HostWindow & {
        finishWrite?: () => void;
        file?: string[];
      };
      host.file = [];
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: async () => ({
          name: "chosen.dnbm.json",
          createWritable: async () => ({
            write: () =>
              new Promise<void>((resolve) => {
                host.finishWrite = resolve;
              }),
            close: async () => host.file?.push("closed"),
            abort: async () => host.file?.push("aborted"),
          }),
        }),
      });
    });
    try {
      await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
      await sequencer.locator('.files button:text-is("save")').click();
      await page.waitForFunction(
        () => (window as unknown as { finishWrite?: unknown }).finishWrite !== undefined,
      );
      await page.evaluate(() => {
        (window as unknown as HostWindow).sequencerApp?.destroy();
        (window as unknown as { finishWrite(): void }).finishWrite();
      });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as unknown as { file: string[] }).file)).toEqual([
        "aborted",
      ]);
    } finally {
      await page.evaluate(() =>
        Object.defineProperty(window, "showSaveFilePicker", {
          configurable: true,
          value: undefined,
        }),
      );
    }
  }, 20_000);

  test("destroying the app while its audio starts closes the audio context", async () => {
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    const requested = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    await page.route("**/engine.wasm", async (route) => {
      requested.resolve();
      await released.promise;
      await route.continue();
    });
    try {
      const before = await page.evaluate(() => (window as unknown as HostWindow).contexts.length);
      await sequencer.locator(".play").click();
      await requested.promise;
      expect(await page.evaluate(() => (window as unknown as HostWindow).contexts.length)).toBe(
        before + 1,
      );
      await page.evaluate(() => (window as unknown as HostWindow).sequencerApp?.destroy());
    } finally {
      released.resolve();
    }
    await page.waitForFunction(() =>
      (window as unknown as HostWindow).contexts.every((context) => context.state === "closed"),
    );
    // Once the engine's module arrives, nothing restarts or reopens audio.
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() =>
        (window as unknown as HostWindow).contexts.every((context) => context.state === "closed"),
      ),
    ).toBe(true);
    await page.unroute("**/engine.wasm");
  }, 20_000);

  test("destroying the app just as its engine reports ready closes the audio context", async () => {
    await page.evaluate(() => {
      const host = window as unknown as HostWindow;
      host.sequencerApp?.destroy();
      // Destroy the app right after the worklet's ready message is handled, before the
      // engine's start goes on.
      const property = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage");
      Object.defineProperty(MessagePort.prototype, "onmessage", {
        configurable: true,
        get(this: MessagePort) {
          return property?.get?.call(this);
        },
        set(this: MessagePort, handler: ((event: MessageEvent) => void) | null) {
          property?.set?.call(
            this,
            handler &&
              function (this: MessagePort, event: MessageEvent) {
                handler.call(this, event);
                if ((event.data as { type?: string })?.type === "ready") {
                  if (property) Object.defineProperty(MessagePort.prototype, "onmessage", property);
                  host.sequencerApp?.destroy();
                }
              },
          );
        },
      });
    });
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    await sequencer.locator(".play").click();
    await page.waitForFunction(() => document.querySelector("#window > div") === null);
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() =>
        (window as unknown as HostWindow).contexts.map((context) => context.state),
      ),
    ).not.toContain("running");
    expect(
      await page.evaluate(() =>
        (window as unknown as HostWindow).contexts.every((context) => context.state === "closed"),
      ),
    ).toBe(true);
  }, 20_000);

  test("destroying the app during a WAV export stops its worker and downloads nothing", async () => {
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    const downloads: string[] = [];
    const record = (download: { suggestedFilename(): string }) =>
      downloads.push(download.suggestedFilename());
    page.on("download", record);
    try {
      const before = await page.evaluate(() => (window as unknown as HostWindow).workers.length);
      await sequencer.locator('.files button:text-is("export")').click();
      await page.waitForFunction(
        (count) => (window as unknown as HostWindow).workers.length > count,
        before,
      );
      await page.evaluate(() => (window as unknown as HostWindow).sequencerApp?.destroy());
      expect(
        await page.evaluate(() =>
          (window as unknown as HostWindow).workers.every((worker) => worker.terminated),
        ),
      ).toBe(true);
      // The export would have finished in this time.
      await page.waitForTimeout(3_000);
      expect(downloads).toEqual([]);
    } finally {
      page.off("download", record);
    }
  }, 20_000);

  test("destroying the app just as its export's engine arrives starts no worker", async () => {
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    const before = await page.evaluate(() => {
      // Destroy the app once the export's engine bytes are read, before the export
      // goes on.
      const host = window as unknown as HostWindow;
      const native = Response.prototype.arrayBuffer;
      Response.prototype.arrayBuffer = async function (this: Response) {
        const bytes = await native.call(this);
        if (this.url.endsWith("/engine.wasm")) {
          Response.prototype.arrayBuffer = native;
          host.sequencerApp?.destroy();
        }
        return bytes;
      };
      return host.workers.length;
    });
    await sequencer.locator('.files button:text-is("export")').click();
    await page.waitForFunction(() => document.querySelector("#window > div") === null);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as HostWindow).workers.length)).toBe(
      before,
    );
  }, 20_000);

  test("destroy releases the audio context, animation frames, listeners and element", async () => {
    await page.evaluate(() => (window as unknown as HostWindow).sequencerApp?.destroy());
    const baseline = await windowListeners();
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    await page.evaluate(() => (window as unknown as HostWindow).mountPlayer());
    await sequencer.locator(".play").click();
    await sequencer.locator(".cell.now").first().waitFor({ timeout: 10_000 });
    await player.locator(".control.play").click();
    await page.waitForFunction(
      () =>
        (window as unknown as HostWindow).contexts.filter((context) => context.state === "running")
          .length === 2,
    );
    expect(await windowListeners()).not.toEqual(baseline);

    await page.evaluate(() => {
      const host = window as unknown as HostWindow;
      host.sequencerApp?.destroy();
      host.playerApp?.destroy();
      // Again, as a host's cleanup might: it does nothing.
      host.sequencerApp?.destroy();
    });
    expect(await page.locator("#window > *, #player > *").count()).toBe(0);
    // Every context the apps started, in this test and the ones before, is closed.
    await page.waitForFunction(() =>
      (window as unknown as HostWindow).contexts.every((context) => context.state === "closed"),
    );
    const frames = await page.evaluate(() => (window as unknown as HostWindow).frames);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as HostWindow).frames)).toBe(frames);
    expect(await windowListeners()).toEqual(baseline);
  }, 30_000);

  test("mount, destroy while loading, and mount again shows one app", async () => {
    // A fresh page, whose first mount still has its module and stylesheet to fetch.
    const fresh = await host.browser.newPage({ viewport: { width: 1700, height: 900 } });
    try {
      await fresh.addInitScript(instrument);
      const released = Promise.withResolvers<void>();
      await fresh.route("**/dnbm/mount.js", async (route) => {
        await released.promise;
        await route.continue();
      });
      await fresh.goto(host.url);
      await fresh.evaluate(() => {
        // What React Strict Mode does to an effect: mount, clean up, and mount again.
        const host = window as unknown as HostWindow;
        const container = document.getElementById("window") as HTMLElement;
        const first = host.dnbm.mountDnbm(container, { assetsUrl: "/dnbm/" });
        first.destroy();
        host.firstReady = "pending";
        first.ready.then(
          () => {
            host.firstReady = "resolved";
          },
          () => {
            host.firstReady = "rejected";
          },
        );
        void host.mountSequencer();
      });
      await fresh.waitForTimeout(200);
      expect(await fresh.locator("#window .app").count()).toBe(0);
      released.resolve();
      await fresh.evaluate(() => (window as unknown as HostWindow).sequencerApp?.ready);
      await fresh.waitForTimeout(500);
      // A destroyed instance's `ready` never settles, as a removed frame never loads.
      expect(await fresh.evaluate(() => (window as unknown as HostWindow).firstReady)).toBe(
        "pending",
      );
      expect(await fresh.locator("#window > div").count()).toBe(1);
      expect(await fresh.locator("#window .app").count()).toBe(1);
      expect(await fresh.locator("#window .cell").count()).toBeGreaterThan(0);
    } finally {
      await fresh.close();
    }
  }, 20_000);

  test("ready rejects, and the app says why, when its assets are missing", async () => {
    const result = await page.evaluate(async () => {
      const window_ = window as unknown as HostWindow;
      const container = document.getElementById("player") as HTMLElement;
      const app = window_.dnbm.mountDnbmPlayer(container, { assetsUrl: "/missing/" });
      const outcome = await app.ready.then(
        () => "resolved",
        (error: unknown) => `rejected: ${error instanceof Error ? error.name : error}`,
      );
      const failure = app.element.shadowRoot?.querySelector(".failure");
      const message = failure?.textContent;
      // Readable without the stylesheet that failed to load.
      const colour = failure && getComputedStyle(failure).color;
      app.destroy();
      return { outcome, message, colour };
    });
    expect(result.outcome).toStartWith("rejected");
    expect(result.message).toStartWith("dnbm couldn't start:");
    expect(result.colour).toBe("rgb(138, 138, 138)");
    expect(errors).toEqual([]);
  }, 20_000);
});
