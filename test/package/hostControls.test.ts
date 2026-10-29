// The packaged apps driven by a host's own controls (support.ts serves the host page in
// the shared Chrome).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright-core";
import { TEARDOWN_TIMEOUT } from "../../scripts/testing/chrome";
import type { DnbmOptions, DnbmSequencerInstance } from "../../src/index";
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

// The packaged apps driven by a host's own controls, as a2f0.net's window menus, toolbar
// and status bar drive them: through each instance's commands and state, never its
// shadow root.
describe("the packaged app driven by its host's controls", () => {
  let host: HostPage;
  let page: Page;
  let sequencer: Locator;
  let player: Locator;
  const errors: string[] = [];

  beforeAll(async () => {
    host = await openHostPage(errors);
    ({ page } = host);
    sequencer = page.locator("#window");
    player = page.locator("#player");
  }, SETUP_TIMEOUT);

  afterAll(() => host?.close(), TEARDOWN_TIMEOUT);
  /**
   * Presses the host's own button, which runs `command` on an app as a host's menu item
   * or toolbar button would, with the user's activation, and says what `run` returned.
   */
  async function hostRun(
    command: string,
    app: "sequencerApp" | "playerApp" = "sequencerApp",
  ): Promise<boolean | undefined> {
    await page.evaluate(
      ([command, app]) => {
        const host = window as unknown as HostWindow;
        host.ran = undefined;
        host.hostAction = () => {
          host.ran = host[app]?.run(command as never);
        };
      },
      [command, app] as const,
    );
    await page.click("#host-play");
    return page.evaluate(() => (window as unknown as HostWindow).ran);
  }

  /** An app's state, as the host reads it. */
  function state(app: "sequencerApp" | "playerApp" = "sequencerApp") {
    return page.evaluate(
      (app) => (window as unknown as HostWindow)[app]?.state as unknown as Record<string, unknown>,
      app,
    );
  }

  /** Mounts the sequencer on a song that is just the example's, saved. */
  async function freshSequencer(options: Partial<DnbmOptions> = {}): Promise<void> {
    await page.evaluate((options) => {
      localStorage.clear();
      return (window as unknown as HostWindow).mountSequencer(options);
    }, options);
  }

  /** Drags from the middle of one element to the middle of another, `dy` pixels lower. */
  async function drag(from: Locator, to: Locator, dy = 0): Promise<void> {
    const start = await from.boundingBox();
    const end = await to.boundingBox();
    if (!start || !end) throw new Error("not visible");
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2 + dy, { steps: 6 });
    await page.mouse.up();
  }

  test("presses on steps and knobs reach the host's mousedown listener, and still paint and turn", async () => {
    await freshSequencer();
    await page.evaluate(() => {
      (window as unknown as HostWindow).mousedowns = [];
    });
    const steps = sequencer.locator('.grid-row[data-track="0"] .cell');
    const painted = () =>
      steps.evaluateAll((cells) => cells.slice(1, 4).map((cell) => cell.classList.contains("hit")));
    expect(await painted()).toEqual([false, false, false]);
    await drag(steps.nth(1), steps.nth(3));
    expect(await painted()).toEqual([true, true, true]);
    const focus = () =>
      page.evaluate(() => {
        const host = window as unknown as HostWindow;
        const root = host.shadow("window") as ShadowRoot & { getSelection?(): Selection | null };
        return {
          // A host's open menu closes on these.
          mousedowns: host.mousedowns,
          selected: [document.getSelection()?.toString(), root.getSelection?.()?.toString()],
          focused: root.activeElement?.getAttribute("aria-label"),
          scrolled: window.scrollY,
        };
      });
    expect(await focus()).toEqual({
      mousedowns: ["window"],
      selected: ["", ""],
      focused: "Steps. Arrows move; keys enter steps.",
      scrolled: 0,
    });

    const knob = sequencer.locator(".device .knob").first();
    const before = Number(await knob.getAttribute("aria-valuenow"));
    await drag(knob, knob, -40);
    expect(Number(await knob.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
    expect(await focus()).toEqual({
      mousedowns: ["window", "window"],
      selected: ["", ""],
      focused: "Tune",
      scrolled: 0,
    });
    // The grid's keys still reach it after a press.
    await steps.nth(5).click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("x");
    expect(await steps.nth(6).getAttribute("class")).toContain("hit");
  }, 20_000);

  test("takes no command and reports an idle state before it is ready and once destroyed", async () => {
    const result = await page.evaluate(async () => {
      const host = window as unknown as HostWindow;
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
      const ready = host.mountSequencer();
      const app = host.sequencerApp as DnbmSequencerInstance;
      const idle = app.state;
      const frozen = [Object.isFrozen(idle), Object.isFrozen(idle.available)];
      const early = [app.run("togglePlay"), app.run("new")];
      const heard: string[] = [];
      app.subscribe((state) => heard.push(`${state.title} ${state.playing}`));
      await ready;
      const atReady = app.state;
      await tick();
      const heardAtReady = [...heard];
      const resumed = host.resumedClosed;
      // A command, then the host's destroy, before anything it started goes on.
      const ran = app.run("togglePlay");
      app.destroy();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        idle,
        frozen,
        early,
        atReady,
        heardAtReady,
        ran,
        heard,
        after: app.state,
        frozenAfter: [Object.isFrozen(app.state), Object.isFrozen(app.state.available)],
        late: [app.run("play"), app.run("stop"), app.run("toString" as never)],
        resumedClosed: host.resumedClosed - resumed,
        unsubscribe: typeof app.subscribe(() => heard.push("late")),
      };
    });
    const none = {
      play: false,
      stop: false,
      togglePlay: false,
      new: false,
      open: false,
      save: false,
      saveAs: false,
      export: false,
      undo: false,
      redo: false,
    };
    const idle = { playing: false, title: "", fileName: "", dirty: false, available: none };
    expect(result.idle).toEqual(idle);
    expect(result.early).toEqual([false, false]);
    // A host can't change the idle state every instance shares.
    expect(result.frozen).toEqual([true, true]);
    expect(result.frozenAfter).toEqual([true, true]);
    expect(result.atReady).toMatchObject({
      playing: false,
      title: "Undertow",
      fileName: "undertow.dnbm.json",
      available: { togglePlay: true, play: true, stop: false, save: true },
    });
    expect(result.heardAtReady).toEqual(["Undertow false"]);
    expect(result.ran).toBe(true);
    // Nothing reaches a subscriber once the instance is destroyed.
    expect(result.heard).toEqual(["Undertow false"]);
    expect(result.after).toEqual(idle);
    expect(result.late).toEqual([false, false, false]);
    expect(result.resumedClosed).toBe(0);
    expect(result.unsubscribe).toBe("function");
    await page.waitForFunction(() =>
      (window as unknown as HostWindow).contexts.every((context) => context.state === "closed"),
    );
    expect(errors).toEqual([]);
  }, 20_000);

  test("the host's controls play, stop, undo and redo, and the state follows", async () => {
    await freshSequencer();
    await page.evaluate(() => {
      const host = window as unknown as HostWindow & { heard: unknown[] };
      host.heard = [];
      host.sequencerApp?.subscribe((state) => host.heard.push(state));
    });
    expect(await hostRun("togglePlay")).toBe(true);
    await sequencer.locator(".cell.now").first().waitFor({ timeout: 10_000 });
    expect(await state()).toMatchObject({ playing: true, available: { play: false, stop: true } });
    expect(await sequencer.locator(".play").getAttribute("aria-label")).toBe("Stop");
    expect(await hostRun("play")).toBe(false);
    expect(await hostRun("stop")).toBe(true);
    await page.waitForFunction(
      () => !(window as unknown as HostWindow).sequencerApp?.state.playing,
    );
    expect(await sequencer.locator(".cell.now").count()).toBe(0);

    await sequencer.locator('.grid-row[data-track="0"] .cell').nth(2).click();
    await page.waitForFunction(() => (window as unknown as HostWindow).sequencerApp?.state.dirty);
    expect(await state()).toMatchObject({ available: { undo: true, redo: false } });
    expect(await hostRun("undo")).toBe(true);
    await page.waitForFunction(() => !(window as unknown as HostWindow).sequencerApp?.state.dirty);
    expect(await state()).toMatchObject({ available: { undo: false, redo: true } });
    expect(await hostRun("undo")).toBe(false);
    expect(await hostRun("redo")).toBe(true);
    await page.waitForFunction(() => (window as unknown as HostWindow).sequencerApp?.state.dirty);

    const heard = await page.evaluate(() => {
      const host = window as unknown as HostWindow & { heard: { playing: boolean }[] };
      return {
        playing: host.heard.map((state) => state.playing),
        last: host.heard.at(-1) === host.sequencerApp?.state,
        frozen: host.heard.every((state) => Object.isFrozen(state)),
      };
    });
    expect(heard.playing).toContain(true);
    expect(heard.playing.at(-1)).toBe(false);
    expect(heard.last).toBe(true);
    expect(heard.frozen).toBe(true);
    expect(errors).toEqual([]);
  }, 30_000);

  test("new asks in the app's own dialog, and no command is available while it asks", async () => {
    // The redone edit above is unsaved.
    expect(await state()).toMatchObject({ dirty: true });
    expect(await hostRun("new")).toBe(true);
    const dialog = sequencer.getByRole("dialog", { name: "Discard unsaved changes to this song?" });
    await dialog.waitFor();
    await page.waitForFunction(
      () => !(window as unknown as HostWindow).sequencerApp?.state.available.togglePlay,
    );
    expect(Object.values((await state())["available"] as object)).not.toContain(true);
    expect(await hostRun("save")).toBe(false);
    await dialog.locator('button:text-is("discard")').click();
    await page.waitForFunction(
      () => (window as unknown as HostWindow).sequencerApp?.state.title === "Untitled",
    );
    expect(await state()).toMatchObject({
      dirty: false,
      fileName: "untitled.dnbm.json",
      available: { new: true, save: true, export: true },
    });
    // The new song is short, so it exports in a moment.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      hostRun("export"),
    ]);
    expect(download.suggestedFilename()).toBe("untitled.wav");
  }, 30_000);

  test("save as, save and open run from the host's button with the user's activation", async () => {
    // File pickers as Chromium's: they need the user's activation.
    await page.evaluate(
      (song) => {
        const host = window as unknown as HostWindow & { activations: string[]; written: string[] };
        host.activations = [];
        host.written = [];
        const pick = (name: string) => {
          host.activations.push(`${name} ${navigator.userActivation.isActive}`);
          if (!navigator.userActivation.isActive) {
            throw new DOMException("Must be handling a user gesture.", "SecurityError");
          }
        };
        Object.defineProperty(window, "showSaveFilePicker", {
          configurable: true,
          value: async () => {
            pick("save");
            return {
              name: "chosen.dnbm.json",
              createWritable: async () => ({
                write: async (text: string) => host.written.push(text),
                close: async () => {},
                abort: async () => {},
              }),
            };
          },
        });
        Object.defineProperty(window, "showOpenFilePicker", {
          configurable: true,
          value: async () => {
            pick("open");
            const file = new File([song], "wraith.dnbm.json", { type: "application/json" });
            return [{ name: file.name, getFile: async () => file }];
          },
        });
      },
      await readFile(join(installed, "site", "songs", "wraith.dnbm.json"), "utf8"),
    );
    try {
      await sequencer.locator(".title").fill("Night Bus");
      await sequencer.locator(".title").press("Enter");
      await page.waitForFunction(() => (window as unknown as HostWindow).sequencerApp?.state.dirty);
      expect(await hostRun("saveAs")).toBe(true);
      await page.waitForFunction(
        () => (window as unknown as HostWindow).sequencerApp?.state.fileName === "chosen.dnbm.json",
      );
      expect(await state()).toMatchObject({ title: "Night Bus", dirty: false });
      // Save writes to the chosen file again, without asking.
      await sequencer.locator('.grid-row[data-track="0"] .cell').nth(1).click();
      expect(await hostRun("save")).toBe(true);
      await page.waitForFunction(
        () => !(window as unknown as HostWindow).sequencerApp?.state.dirty,
      );
      expect(await hostRun("open")).toBe(true);
      await page.waitForFunction(
        () => (window as unknown as HostWindow).sequencerApp?.state.title === "Wraith",
      );
      expect(
        await page.evaluate(() => {
          const host = window as unknown as HostWindow & {
            activations: string[];
            written: string[];
          };
          return { activations: host.activations, writes: host.written.length };
        }),
      ).toEqual({ activations: ["save true", "open true"], writes: 2 });
    } finally {
      await page.evaluate(() => {
        for (const name of ["showOpenFilePicker", "showSaveFilePicker"]) {
          Object.defineProperty(window, name, { configurable: true, value: undefined });
        }
      });
    }
    // Without the pickers, open falls back to a file input, which also needs the activation.
    const chooser = page.waitForEvent("filechooser");
    expect(await hostRun("open")).toBe(true);
    await (await chooser).setFiles({
      name: "undertow.dnbm.json",
      mimeType: "application/json",
      buffer: await readFile(join(installed, "site", "songs", "undertow.dnbm.json")),
    });
    await page.waitForFunction(
      () => (window as unknown as HostWindow).sequencerApp?.state.title === "Undertow",
    );
    expect(await state()).toMatchObject({ fileName: "undertow.dnbm.json", dirty: false });
  }, 30_000);

  test("commands the host's destroy interrupts change nothing and reach no one", async () => {
    const song = () =>
      page.evaluate(
        () => (JSON.parse(localStorage.getItem("dnbm:song") ?? "{}") as { title?: string }).title,
      );
    // Open, then destroy in the same task: no file picker opens for the gone app.
    await freshSequencer();
    let choosers = 0;
    const count = () => {
      choosers += 1;
    };
    page.on("filechooser", count);
    try {
      await page.evaluate(() => {
        const host = window as unknown as HostWindow;
        host.hostAction = () => {
          host.ran = host.sequencerApp?.run("open");
          host.sequencerApp?.destroy();
        };
      });
      await page.click("#host-play");
      expect(await page.evaluate(() => (window as unknown as HostWindow).ran)).toBe(true);
      await page.waitForTimeout(500);
      expect(choosers).toBe(0);
    } finally {
      page.off("filechooser", count);
    }

    // Open: the file is chosen once the app is gone.
    await freshSequencer();
    const chooser = page.waitForEvent("filechooser");
    expect(await hostRun("open")).toBe(true);
    await page.evaluate(() => (window as unknown as HostWindow).sequencerApp?.destroy());
    await (await chooser).setFiles({
      name: "wraith.dnbm.json",
      mimeType: "application/json",
      buffer: await readFile(join(installed, "site", "songs", "wraith.dnbm.json")),
    });
    await page.waitForTimeout(300);
    // A fresh mount stores nothing until an edit, and the gone app opened nothing.
    expect(await song()).toBeUndefined();

    // New, while its dialog asks: the dialog goes with the app.
    await freshSequencer();
    await sequencer.locator('.grid-row[data-track="0"] .cell').nth(1).click();
    await page.evaluate(() => {
      const host = window as unknown as HostWindow & { heard: unknown[] };
      host.heard = [];
      host.sequencerApp?.subscribe((state) => host.heard.push(state));
    });
    expect(await hostRun("new")).toBe(true);
    await sequencer.getByRole("dialog").waitFor();
    const heard = await page.evaluate(async () => {
      const host = window as unknown as HostWindow & { heard: unknown[] };
      const before = host.heard.length;
      host.sequencerApp?.destroy();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return host.heard.length - before;
    });
    expect(heard).toBe(0);
    expect(await song()).toBe("Undertow");

    // Export: its worker stops, and nothing downloads.
    await freshSequencer();
    const downloads: string[] = [];
    const record = (download: { suggestedFilename(): string }) =>
      downloads.push(download.suggestedFilename());
    page.on("download", record);
    try {
      const before = await page.evaluate(() => (window as unknown as HostWindow).workers.length);
      expect(await hostRun("export")).toBe(true);
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
      await page.waitForTimeout(1_500);
      expect(downloads).toEqual([]);
    } finally {
      page.off("download", record);
    }
    expect(errors).toEqual([]);
  }, 30_000);

  test("the player's state follows the host's controls", async () => {
    await page.evaluate(() => (window as unknown as HostWindow).mountPlayer());
    expect(await state("playerApp")).toEqual({
      playing: false,
      paused: false,
      title: "Wraith",
      shuffle: false,
      repeat: false,
      available: {
        play: true,
        pause: false,
        togglePlay: true,
        stop: false,
        previous: true,
        next: true,
        toggleShuffle: true,
        toggleRepeat: true,
      },
    });
    /** Waits for the player's state to hold these values. */
    const until = (expected: Record<string, unknown>) =>
      page.waitForFunction(
        (expected) => {
          const state = (window as unknown as HostWindow).playerApp?.state as unknown as
            | Record<string, unknown>
            | undefined;
          return Object.entries(expected).every(([key, value]) => state?.[key] === value);
        },
        expected,
        { timeout: 15_000 },
      );
    expect(await hostRun("togglePlay", "playerApp")).toBe(true);
    await until({ playing: true, paused: false });
    expect(await state("playerApp")).toMatchObject({
      available: { play: false, pause: true, stop: true },
    });
    await page.waitForFunction(
      () =>
        (window as unknown as HostWindow).shadow("player").querySelector(".time")?.textContent !==
        "0:00",
      undefined,
      { timeout: 15_000 },
    );
    expect(await hostRun("pause", "playerApp")).toBe(true);
    await until({ playing: false, paused: true });
    expect(await state("playerApp")).toMatchObject({ available: { play: true, pause: false } });
    expect(await player.locator(".player").getAttribute("data-state")).toBe("paused");
    expect(await hostRun("pause", "playerApp")).toBe(false);
    expect(await hostRun("togglePlay", "playerApp")).toBe(true);
    await until({ playing: true, paused: false });
    expect(await hostRun("next", "playerApp")).toBe(true);
    await until({ title: "Undertow", playing: true });
    // Stopped, previous moves to the song before, however long the last one played.
    expect(await hostRun("stop", "playerApp")).toBe(true);
    await until({ playing: false, paused: false });
    expect(await state("playerApp")).toMatchObject({ available: { stop: false, play: true } });
    expect(await hostRun("stop", "playerApp")).toBe(false);
    expect(await hostRun("previous", "playerApp")).toBe(true);
    await until({ title: "Wraith", playing: false });
    // A seek while stopped moves where play starts; stop, as its button does, goes back.
    await player.locator(".seek").evaluate((seek: HTMLInputElement) => {
      seek.value = "30";
      seek.dispatchEvent(new Event("change"));
    });
    await page.waitForFunction(
      () => (window as unknown as HostWindow).playerApp?.state.available.stop,
    );
    expect(await player.locator(".time").textContent()).not.toBe("0:00");
    expect(await hostRun("stop", "playerApp")).toBe(true);
    expect(await player.locator(".time").textContent()).toBe("0:00");
    expect(await state("playerApp")).toMatchObject({ available: { stop: false } });
    expect(await hostRun("toggleShuffle", "playerApp")).toBe(true);
    expect(await hostRun("toggleRepeat", "playerApp")).toBe(true);
    await until({ shuffle: true, repeat: true });
    expect(await player.locator(".control.repeat").getAttribute("aria-pressed")).toBe("true");
    expect(await hostRun("toggleShuffle", "playerApp")).toBe(true);
    expect(await hostRun("toggleRepeat", "playerApp")).toBe(true);
    await until({ playing: false, paused: false, shuffle: false, repeat: false });
    expect(await player.locator(".player").getAttribute("data-state")).toBe("stopped");
    expect(errors).toEqual([]);
  }, 40_000);

  test("without their own action buttons, the apps keep their other controls and shortcuts, side by side", async () => {
    const measure = () =>
      page.evaluate(() => {
        const host = window as unknown as HostWindow;
        const editor = host.shadow("window");
        const playerRoot = host.shadow("player");
        const transport = editor.querySelector(".transport");
        const first = transport?.firstElementChild;
        return {
          topBar: editor.querySelector(".topbar")?.getBoundingClientRect().height,
          // Nothing is left where the play button was.
          transportStart:
            (first?.getBoundingClientRect().left ?? 0) -
            (transport?.getBoundingClientRect().left ?? 0),
          transport: [...(transport?.children ?? [])].map((child) => child.className),
          files: [...(editor.querySelector(".files")?.children ?? [])].map(
            (child) => child.tagName,
          ),
          controls: [...(playerRoot.querySelector(".controls")?.children ?? [])].map(
            (child) => child.className,
          ),
        };
      });
    await freshSequencer();
    await page.evaluate(() => (window as unknown as HostWindow).mountPlayer());
    const shown = await measure();
    expect(shown.transport[0]).toBe("play");
    expect(shown.files.filter((tag) => tag === "BUTTON")).toHaveLength(6);
    expect(shown.controls).toEqual(["transport", "modes", "volume"]);

    await freshSequencer({ actions: false });
    await page.evaluate(() => (window as unknown as HostWindow).mountPlayer({ actions: false }));
    const hidden = await measure();
    expect(hidden).toEqual({
      topBar: shown.topBar,
      transportStart: 0,
      transport: ["segmented", "bpm-field", "control knob", "position"],
      // The example songs stay: no command opens them.
      files: ["SELECT"],
      controls: ["volume"],
    });
    expect(await sequencer.locator(".title").isVisible()).toBe(true);

    // Their keys still work inside each, and the host's controls drive both at once.
    await sequencer.locator(".statusbar").click();
    await page.keyboard.press("Space");
    await sequencer.locator(".cell.now").first().waitFor({ timeout: 10_000 });
    await player.locator(".summary").click();
    await page.keyboard.press("x");
    await page.waitForFunction(() => (window as unknown as HostWindow).playerApp?.state.playing);
    expect(await state()).toMatchObject({ playing: true });
    expect(await hostRun("stop")).toBe(true);
    await page.waitForFunction(
      () => !(window as unknown as HostWindow).sequencerApp?.state.playing,
    );
    expect(await state("playerApp")).toMatchObject({ playing: true });
    expect(await hostRun("stop", "playerApp")).toBe(true);
    await page.waitForFunction(() => !(window as unknown as HostWindow).playerApp?.state.playing);
    expect(errors).toEqual([]);
  }, 40_000);
});
