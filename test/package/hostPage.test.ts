// The packaged apps in a real browser, mounted into a host page's own document: how
// they look, play and edit there (support.ts serves the host page in the shared Chrome).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright-core";
import { TEARDOWN_TIMEOUT } from "../../scripts/testing/chrome";
import {
  type HostPage,
  type HostWindow,
  openHostPage,
  packedPackage,
  SETUP_TIMEOUT,
} from "./support";

let installed = "";

beforeAll(async () => {
  ({ installed } = await packedPackage());
}, SETUP_TIMEOUT);

describe("the packaged app mounted in a host page", () => {
  let host: HostPage;
  let page: Page;
  let sequencer: Locator;
  let player: Locator;
  const errors: string[] = [];

  beforeAll(async () => {
    host = await openHostPage(errors);
    ({ page } = host);
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    sequencer = page.locator("#window");
    player = page.locator("#player");
  }, SETUP_TIMEOUT);

  afterAll(() => host?.close(), TEARDOWN_TIMEOUT);

  test("mounts in a shadow root, ready once it shows, embedded without the wordmark", async () => {
    expect(await page.locator("iframe").count()).toBe(0);
    const app = await page.evaluate(() => {
      const element = document.querySelector("#window > div");
      const root = element?.shadowRoot;
      return {
        role: element?.getAttribute("role"),
        label: element?.getAttribute("aria-label"),
        size: [element?.clientWidth, element?.clientHeight],
        embedded: root?.querySelector(".frame")?.hasAttribute("data-embed"),
        steps: root?.querySelectorAll(".cell").length,
        styled: root?.querySelector("link")?.sheet !== null,
        title: document.title,
      };
    });
    expect(app).toEqual({
      role: "region",
      label: "dnbm drum and bass sequencer",
      size: [1200, 800],
      embedded: true,
      steps: expect.any(Number),
      styled: true,
      // Only the site's own page shows the song in its title.
      title: "host",
    });
    expect(app.steps).toBeGreaterThan(0);
    expect(await sequencer.locator(".brand").isVisible()).toBe(false);
  });

  test("keeps its styles and the host page's apart", async () => {
    const styles = await page.evaluate(() => {
      const root = document.querySelector("#window > div")?.shadowRoot;
      const help = root?.querySelector(".status-help");
      const cell = root?.querySelector(".cell");
      const hostPlay = document.getElementById("host-play");
      if (!help || !cell || !hostPlay) throw new Error("missing elements");
      const helpStyle = getComputedStyle(help);
      const frame = root?.querySelector(".frame");
      return {
        direction: frame && getComputedStyle(frame).direction,
        helpFont: [
          helpStyle.fontSize,
          helpStyle.fontStyle,
          helpStyle.letterSpacing,
          helpStyle.wordSpacing,
          helpStyle.textTransform,
          helpStyle.color,
        ],
        monospace: helpStyle.fontFamily.includes("monospace"),
        background: frame && getComputedStyle(frame).backgroundColor,
        cell: getComputedStyle(cell).display,
        hostPlay: [getComputedStyle(hostPlay).backgroundColor, getComputedStyle(hostPlay).width],
      };
    });
    // The host's rules for every element and every div, which match the app's own
    // element, reach nothing inside it.
    expect(styles.helpFont).toEqual(["11px", "normal", "normal", "0px", "none", "rgb(84, 84, 84)"]);
    expect(styles.monospace).toBe(true);
    expect(styles.background).toBe("rgb(10, 10, 10)");
    // The host's right-to-left containers don't mirror the app.
    expect(styles.direction).toBe("ltr");
    expect(styles.cell).toBe("block");
    // The app's .play rules (a 36px square) never reach the host's own .play button.
    expect(styles.hostPlay[0]).toBe("rgb(255, 255, 255)");
    expect(styles.hostPlay[1]).not.toBe("36px");
  });

  test("stop cancels playback while the first audio startup is pending", async () => {
    const requested = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    await page.route("**/engine.wasm", async (route) => {
      requested.resolve();
      await released.promise;
      await route.continue();
    });
    try {
      await sequencer.locator(".play").click();
      await requested.promise;
      expect(await sequencer.locator(".play").getAttribute("aria-label")).toBe("Stop");
      await sequencer.locator(".play").click();
    } finally {
      released.resolve();
    }
    await sequencer.locator(".master .meter-fill[style]").first().waitFor({ state: "attached" });
    // Let several actual audio quanta report after the module has finished loading.
    await page.waitForTimeout(200);
    expect(await sequencer.locator(".play").getAttribute("aria-label")).toBe("Play");
    expect(await sequencer.locator(".cell.now").count()).toBe(0);
    await page.unroute("**/engine.wasm");
  }, 20_000);

  test("releasing a preview before startup finishes leaves no held bass note", async () => {
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    const requested = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    await page.route("**/engine.wasm", async (route) => {
      requested.resolve();
      await released.promise;
      await route.continue();
    });
    try {
      // A click presses and releases the track before the engine can trigger it.
      await sequencer.locator(".track-name").filter({ hasText: /^sub$/ }).click();
      await requested.promise;
    } finally {
      released.resolve();
    }
    await sequencer.locator(".master .meter-fill[style]").first().waitFor({ state: "attached" });
    await page.waitForTimeout(300);
    expect(await sequencer.locator(".master-peak").textContent()).toBe("−∞ dBFS");
    await page.unroute("**/engine.wasm");
  }, 20_000);

  test("starts audio from a click in the app", async () => {
    await sequencer.locator(".play").click();
    // The playhead moves only when the worklet reports steps from the running engine.
    await sequencer.locator(".cell.now").first().waitFor({ timeout: 10_000 });
    await sequencer.locator(".play").click();
  }, 20_000);

  test("playing scrolls its own song row, never the host page", async () => {
    await sequencer.locator(".play").click();
    await sequencer.locator(".chip.now").waitFor();
    const first = await sequencer.locator(".chip.now").getAttribute("data-slot");
    // The host page scrolls the app's top, where the playing slot shows, out of view.
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForFunction(
      (slot) =>
        (window as unknown as HostWindow)
          .shadow("window")
          .querySelector(".chip.now")
          ?.getAttribute("data-slot") !== slot,
      first,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(600);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sequencer.locator(".play").click();
  }, 30_000);

  test("a held preview releases outside the grid after switching patterns", async () => {
    const sub = sequencer.locator(".track-name").filter({ hasText: /^sub$/ });
    const bounds = await sub.boundingBox();
    if (!bounds) throw new Error("sub track is not visible");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => {
      const root = (window as unknown as HostWindow).shadow("window");
      const strips = [...root.querySelectorAll(".strips .strip")];
      const sub = strips.find((strip) => strip.querySelector(".strip-name")?.textContent === "sub");
      return (
        Number.parseFloat(sub?.querySelector<HTMLElement>(".meter-fill")?.style.height ?? "0") > 0
      );
    });
    // Follow can replace every row while a pointer is held. Change patterns without
    // releasing the mouse to reproduce that replacement while the note is sounding.
    await sequencer
      .locator('.tab[data-pattern="roll"]')
      .evaluate((tab: HTMLButtonElement) => tab.click());
    await page.mouse.move(10, 10);
    await page.mouse.up();
    await page.waitForFunction(() => {
      const root = (window as unknown as HostWindow).shadow("window");
      return [...root.querySelectorAll<HTMLElement>(".strips .meter-fill")].every(
        (fill) => Number.parseFloat(fill.style.height) === 0,
      );
    });
    const peak = sequencer.locator(".master-peak");
    const held = Number.parseFloat((await peak.textContent()) ?? "");
    expect(Number.isFinite(held)).toBe(true);
    await peak.click();
    const reset = (await peak.textContent()) ?? "";
    // An effects tail can already have supplied another reading after the reset.
    expect(reset === "−∞ dBFS" || Number.parseFloat(reset) < held - 6).toBe(true);
  }, 20_000);

  test("track buttons work from the keyboard without editing steps or starting playback", async () => {
    const row = sequencer.locator('.grid-row[data-track="0"]');
    const before = await row
      .locator(".cell")
      .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("aria-label")));
    const mute = row.getByRole("button", { name: "Mute kick", exact: true });
    await mute.press("Enter");
    expect(await mute.getAttribute("aria-pressed")).toBe("true");
    expect(await sequencer.locator(".strips .strip").first().getAttribute("class")).toContain(
      "inaudible",
    );
    await mute.press("Space");
    expect(await mute.getAttribute("aria-pressed")).toBe("false");
    expect(await sequencer.locator(".play").getAttribute("aria-label")).toBe("Play");
    expect(
      await row
        .locator(".cell")
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("aria-label"))),
    ).toEqual(before);
    // Selecting a track with Enter auditions it, without entering a grid step.
    await row.locator(".track-name").press("Enter");
    expect(await sequencer.locator(".device-name").inputValue()).toBe("kick");
  }, 20_000);

  test("browsing a pattern pauses follow and returning to follow restores the playhead", async () => {
    await sequencer.locator(".play").click();
    await sequencer.locator(".cell.now").first().waitFor();
    const selected = sequencer.locator('.tab[data-pattern="pressure"]');
    await selected.click();
    expect(await selected.getAttribute("aria-selected")).toBe("true");
    const follow = sequencer.getByRole("button", { name: "follow", exact: true });
    expect(await follow.getAttribute("aria-pressed")).toBe("false");
    await page.waitForTimeout(200);
    expect(await selected.getAttribute("aria-selected")).toBe("true");
    expect(await sequencer.locator(".cell.now").count()).toBe(0);
    await follow.click();
    await page.waitForFunction(() => {
      const root = (window as unknown as HostWindow).shadow("window");
      const playing = root.querySelector(".chip.now");
      return (
        playing &&
        root.querySelector('.tab[aria-selected="true"]')?.textContent === playing.textContent
      );
    });
    await sequencer.locator(".cell.now").first().waitFor();
    await sequencer.locator(".play").click();
  }, 20_000);

  test("Space controls playback after mouse clicks without repeating the clicked action", async () => {
    const mute = sequencer.locator('.grid-row[data-track="0"] [data-action="mute"]');
    await mute.click();
    await page.keyboard.press("Space");
    await sequencer.locator(".cell.now").first().waitFor();
    expect(await mute.getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Space");
    expect(await sequencer.locator(".play").getAttribute("aria-label")).toBe("Play");
    expect(await mute.getAttribute("aria-pressed")).toBe("true");
    await mute.click();
  }, 20_000);

  test("runs beside the player, each taking only its own keys", async () => {
    await page.evaluate(() => (window as unknown as HostWindow).mountPlayer());
    expect(await player.locator(".track-title").allTextContents()).toEqual(["Wraith", "Undertow"]);
    const playerState = () => player.locator(".player").getAttribute("data-state");
    const sequencerPlaying = async () =>
      (await sequencer.locator(".play").getAttribute("aria-label")) === "Stop";

    // Keys on the host page reach neither app.
    await page.locator("#outside").focus();
    await page.keyboard.press("Space");
    await page.mouse.click(1650, 880);
    await page.keyboard.press("Space");
    await page.keyboard.press("x");
    await page.waitForTimeout(300);
    expect([await sequencerPlaying(), await playerState()]).toEqual([false, "stopped"]);

    // A press anywhere in the player gives it the keyboard, and only it.
    await player.locator(".summary").click();
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () =>
        (window as unknown as HostWindow).shadow("player").querySelector(".time")?.textContent !==
        "0:00",
      undefined,
      { timeout: 15_000 },
    );
    expect([await sequencerPlaying(), await playerState()]).toEqual([false, "playing"]);

    // A press anywhere in the sequencer moves the keyboard there; both play at once.
    await sequencer.locator(".statusbar").click();
    await page.keyboard.press("Space");
    await sequencer.locator(".cell.now").first().waitFor();
    expect([await sequencerPlaying(), await playerState()]).toEqual([true, "playing"]);

    // Closing the player leaves the sequencer playing; reopening it starts afresh.
    await page.evaluate(() => (window as unknown as HostWindow).mountPlayer());
    expect(await playerState()).toBe("stopped");
    await page.waitForTimeout(200);
    expect(await sequencerPlaying()).toBe(true);
    await page.keyboard.press("Space");
    expect(await sequencerPlaying()).toBe(false);
    await page.evaluate(() => (window as unknown as HostWindow).playerApp?.destroy());
  }, 40_000);

  test("asks before discarding edits with a dialog inside the app", async () => {
    await sequencer.locator('.grid-row[data-track="0"] .cell').nth(1).click();
    await sequencer.locator('button:text-is("new")').click();
    const dialog = sequencer.getByRole("dialog", { name: "Discard unsaved changes to this song?" });
    await dialog.waitFor();
    const placement = await page.evaluate(() => {
      const root = document.querySelector("#window > div")?.shadowRoot;
      return {
        inRoot: root?.querySelector("dialog[open]") !== null,
        inDocument: document.querySelectorAll("dialog").length,
        appInert: root?.querySelector<HTMLElement>(".frame")?.inert,
      };
    });
    expect(placement).toEqual({ inRoot: true, inDocument: 0, appInert: true });
    // The rest of the host page stays usable.
    await page.locator("#outside").focus();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("outside");
    await dialog.locator('button:text-is("discard")').click();
    await page.waitForFunction(
      () =>
        (window as unknown as HostWindow).shadow("window").querySelector<HTMLInputElement>(".title")
          ?.value === "Untitled",
    );
    expect(
      await page.evaluate(
        () =>
          (window as unknown as HostWindow).shadow("window").querySelector<HTMLElement>(".frame")
            ?.inert,
      ),
    ).toBe(false);
  }, 20_000);

  test("cancel and Escape keep unsaved edits", async () => {
    const step = sequencer.locator('.grid-row[data-track="0"] .cell').nth(2);
    await step.click();
    expect(await step.getAttribute("class")).toContain("hit");
    for (const dismiss of ["cancel", "Escape"]) {
      await sequencer.locator('button:text-is("new")').click();
      const dialog = sequencer.getByRole("dialog", {
        name: "Discard unsaved changes to this song?",
      });
      await dialog.waitFor();
      if (dismiss === "cancel") await dialog.locator('button:text-is("cancel")').click();
      else await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      expect([dismiss, await step.getAttribute("class")]).toEqual([
        dismiss,
        expect.stringContaining("hit"),
      ]);
    }
  }, 20_000);

  test("renames a pattern through a prompt inside the app, and keeps it on cancel", async () => {
    const prompt = sequencer.getByRole("dialog", { name: /Pattern id/ });
    await sequencer.locator('button:text-is("rename")').click();
    await prompt.waitFor();
    expect(await prompt.locator("input").inputValue()).toBe("a");
    await prompt.locator("input").fill("intro");
    await prompt.locator("input").press("Enter");
    await sequencer.locator('.tab[data-pattern="intro"]').waitFor();
    expect(await sequencer.locator(".chip").allTextContents()).toEqual(["intro"]);

    await sequencer.locator('button:text-is("rename")').click();
    await prompt.locator("input").fill("ignored");
    await prompt.locator('button:text-is("cancel")').click();
    await prompt.waitFor({ state: "detached" });
    expect(await sequencer.locator(".tab").allTextContents()).toEqual(["intro"]);
  }, 20_000);

  test("saves by downloading where the page has no file picker", async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      sequencer.locator('button:text-is("save")').click(),
    ]);
    expect(download.suggestedFilename()).toBe("untitled.dnbm.json");
    // The rename test's edit is unsaved; saving marks the song clean.
  }, 20_000);

  test("opens a song through a file input after the discard prompt, where the page has no picker", async () => {
    await sequencer.locator('.grid-row[data-track="0"] .cell').nth(3).click();
    const chooser = page.waitForEvent("filechooser");
    await sequencer.locator('.files button:text-is("open")').click();
    await sequencer
      .getByRole("dialog", { name: "Discard unsaved changes to this song?" })
      .locator('button:text-is("discard")')
      .click();
    const song = await readFile(join(installed, "site", "songs", "undertow.dnbm.json"));
    await (await chooser).setFiles({
      name: "undertow.dnbm.json",
      mimeType: "application/json",
      buffer: song,
    });
    await page.waitForFunction(
      () =>
        (window as unknown as HostWindow).shadow("window").querySelector<HTMLInputElement>(".title")
          ?.value === "Undertow",
    );
    expect(await sequencer.locator(".status-message").textContent()).toBe(
      "Opened undertow.dnbm.json.",
    );
  }, 20_000);

  test("cancelling the file input keeps the song", async () => {
    const chooser = page.waitForEvent("filechooser");
    // The song was just opened, so there is nothing to discard and no prompt.
    await sequencer.locator('.files button:text-is("open")').click();
    await (await chooser).setFiles([]);
    expect(await sequencer.locator(".title").inputValue()).toBe("Undertow");
    expect(await sequencer.locator("dialog[open]").count()).toBe(0);
    expect(await sequencer.locator(".status-message").textContent()).toBe(
      "Opened undertow.dnbm.json.",
    );
  }, 20_000);

  test("opens a song file dropped on the app", async () => {
    const text = await readFile(join(installed, "site", "songs", "wraith.dnbm.json"), "utf8");
    const dataTransfer = await page.evaluateHandle((song) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([song], "wraith.dnbm.json", { type: "application/json" }));
      return transfer;
    }, text);
    const grid = sequencer.locator(".grid-scroll");
    await grid.dispatchEvent("dragover", { dataTransfer });
    await grid.dispatchEvent("drop", { dataTransfer });
    await page.waitForFunction(
      () =>
        (window as unknown as HostWindow).shadow("window").querySelector<HTMLInputElement>(".title")
          ?.value === "Wraith",
    );
    expect(await sequencer.locator(".status-message").textContent()).toBe(
      "Opened wraith.dnbm.json.",
    );
  }, 20_000);
});
