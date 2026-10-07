// Packs @a2f0/dnbm exactly as npm publishes it and uses the tarball as a consumer
// would: no repository sources, only what the package ships.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { buildPackage } from "../scripts/buildPackage";
import type { DnbmInstance } from "../src/index";

const ROOT = join(import.meta.dir, "..");

interface Packed {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

interface Metadata {
  readonly name: string;
  readonly private?: boolean;
  readonly license: string;
  readonly publishConfig?: { readonly access?: string };
  readonly scripts: Record<string, string>;
  readonly exports: Record<string, unknown>;
}

let temporary = "";
let consumer = "";
let installed = "";
let packed: Packed;

beforeAll(async () => {
  await buildPackage();
  temporary = await mkdtemp(join(tmpdir(), "dnbm-package-"));
  consumer = join(temporary, "consumer");
  installed = join(consumer, "node_modules", "@a2f0", "dnbm");
  await mkdir(installed, { recursive: true });
  // npm exports its settings to lifecycle scripts (npm_config_dry_run, under
  // `npm publish --dry-run`), and a nested npm would inherit them, so pack without.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_")),
  );
  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
    { cwd: ROOT, encoding: "utf8", env: environment },
  );
  [packed] = JSON.parse(output) as [Packed];
  execFileSync("tar", [
    "-xzf",
    join(temporary, packed.filename),
    "--strip-components=1",
    "-C",
    installed,
  ]);
  await writeFile(
    join(consumer, "package.json"),
    '{ "name": "dnbm-consumer", "type": "module" }\n',
  );
}, 120_000);

afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

async function copyAssets(destination: string): Promise<void> {
  const { copyDnbmAssets } = (await import(
    pathToFileURL(join(installed, "lib", "build.js")).href
  )) as { copyDnbmAssets: (destination: string) => Promise<void> };
  await copyDnbmAssets(destination);
}

describe("the published package", () => {
  test("ships the app and declarations, and nothing from the repository besides docs", async () => {
    const files = packed.files.map((file) => file.path);
    expect(
      files.filter(
        (file) =>
          !/^(lib\/|site\/|docs\/(package|song-format)\.md$|README\.md$|package\.json$)/.test(file),
      ),
    ).toEqual([]);
    for (const file of [
      "lib/index.js",
      "lib/index.d.ts",
      "lib/shell.js",
      "lib/shell.d.ts",
      "lib/build.js",
      "lib/build.d.ts",
      "site/index.html",
      "site/page.css",
      "site/main.js",
      "site/mount.js",
      "site/styles.css",
      "site/worklet.js",
      "site/renderWorker.js",
      "site/engine.wasm",
      "site/songs/index.json",
      "site/songs/undertow.dnbm.json",
      "site/song.schema.json",
      "site/player/index.html",
      "site/player/main.js",
      "site/player/mount.js",
      "site/player/styles.css",
      "docs/package.md",
    ]) {
      expect(files).toContain(file);
    }
    // Cloudflare reads _headers only at a deployment's root; in a host it would just be served.
    expect(files).not.toContain("site/_headers");

    const metadata = JSON.parse(
      await readFile(join(installed, "package.json"), "utf8"),
    ) as Metadata;
    expect(metadata.name).toBe("@a2f0/dnbm");
    expect(metadata.private).toBeUndefined();
    expect(metadata.license).toBe("UNLICENSED");
    // npm publishes a scoped package as restricted unless told otherwise.
    expect(metadata.publishConfig?.access).toBe("public");
    expect(metadata.scripts["postinstall"]).toBeUndefined();
    expect(metadata.scripts["prepare"]).toBeUndefined();
    expect(Object.keys(metadata.exports)).toEqual([".", "./build", "./assets/*", "./package.json"]);
  });

  test("imports without a DOM, and type-checks in a strict consumer through its exports", async () => {
    await writeFile(
      join(consumer, "entry.ts"),
      `import {
  mountDnbm,
  mountDnbmPlayer,
  type DnbmInstance,
  type DnbmOptions,
  type DnbmPlayerOptions,
} from "@a2f0/dnbm";
import { copyDnbmAssets } from "@a2f0/dnbm/build";

export function mount(container: HTMLElement): DnbmInstance {
  const options: DnbmOptions = { assetsUrl: "/dnbm/", branding: false, title: "dnbm" };
  const instance = mountDnbm(container, options);
  const element: HTMLElement = instance.element;
  const ready: Promise<void> = instance.ready;
  void ready.then(() => element.shadowRoot?.querySelector(".cell"));
  return instance;
}
export function mountPlayer(container: HTMLElement): DnbmInstance {
  const options: DnbmPlayerOptions = {
    assetsUrl: "/dnbm/",
    songs: ["/dnbm/songs/undertow.dnbm.json", new URL("https://example.com/a.dnbm.json")],
  };
  return mountDnbmPlayer(container, options);
}
const copy: (destination: string | URL) => Promise<void> = copyDnbmAssets;
console.log(
  JSON.stringify({
    dom: typeof document,
    mount: typeof mountDnbm,
    player: typeof mountDnbmPlayer,
    copy: typeof copy,
  }),
);
`,
    );
    await writeFile(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noEmit: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2023",
          lib: ["es2023", "dom"],
          types: [],
        },
        include: ["entry.ts"],
      }),
    );
    const output = execFileSync("bun", ["entry.ts"], { cwd: consumer, encoding: "utf8" });
    expect(JSON.parse(output)).toEqual({
      dom: "undefined",
      mount: "function",
      player: "function",
      copy: "function",
    });
    const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
    // tsc prints errors on stdout and exits non-zero, which throws here with them.
    execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
      cwd: consumer,
      encoding: "utf8",
    });
  }, 60_000);

  test("leaves the app module's import to the browser when a host bundles it", async () => {
    // The app's code is served with the assets; a host's bundler must not try to bundle
    // it. webpack, Turbopack and Vite read these comments; Bun leaves the import alone.
    const shell = await readFile(join(installed, "lib", "shell.js"), "utf8");
    expect(shell).toContain(
      "import(/* webpackIgnore: true */ /* @vite-ignore */ /* turbopackIgnore: true */ url)",
    );
    const bundled = await Bun.build({
      entrypoints: [join(installed, "lib", "index.js")],
      target: "browser",
      format: "esm",
    });
    expect(bundled.success).toBe(true);
    const [output] = bundled.outputs;
    expect(await output?.text()).toContain("return import(url);");
  });

  test("copies an app that serves from a nested path", async () => {
    const publicDirectory = join(temporary, "public");
    await copyAssets(join(publicDirectory, "apps", "dnbm"));
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        const file = Bun.file(
          join(publicDirectory, path.endsWith("/") ? `${path}index.html` : path),
        );
        return file.size > 0 ? new Response(file) : new Response("Not found", { status: 404 });
      },
    });
    try {
      const page = new URL("/apps/dnbm/", server.url);
      const html = await (await fetch(page)).text();
      const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
      expect(referenced).toEqual(
        expect.arrayContaining(["page.css", "mount.js", "styles.css", "main.js"]),
      );
      // What the page, its app module and the shell load, relative to the assets.
      for (const path of [...referenced, "worklet.js", "renderWorker.js", "songs/index.json"]) {
        expect([path, (await fetch(new URL(path, page))).status]).toEqual([path, 200]);
      }
      const wasm = new Uint8Array(await (await fetch(new URL("engine.wasm", page))).arrayBuffer());
      expect([...wasm.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);

      // The player, one directory down, loads the same engine and songs.
      const player = new URL("player/", page);
      const playerHtml = await (await fetch(player)).text();
      const playerReferenced = [...playerHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
      for (const path of [
        ...playerReferenced,
        "../engine.wasm",
        "../worklet.js",
        "../songs/index.json",
      ]) {
        expect([path, (await fetch(new URL(path, player))).status]).toEqual([path, 200]);
      }
    } finally {
      await server.stop(true);
    }
  });

  test("refuses assets it can't serve before touching the page", async () => {
    const { mountDnbm, mountDnbmPlayer } = (await import(
      pathToFileURL(join(installed, "lib", "index.js")).href
    )) as typeof import("../src/index");
    const container = {
      ownerDocument: {
        baseURI: "https://example.com/apps/",
        createElement: () => {
          throw new Error("touched the page");
        },
      },
    } as unknown as HTMLElement;
    expect(() => mountDnbm(container, { assetsUrl: "file:///dnbm/" })).toThrow("HTTP or HTTPS");
    expect(() => mountDnbm(container, { assetsUrl: "/dnbm/?v=1" })).toThrow("without a query");
    expect(() => mountDnbmPlayer(container, { assetsUrl: "file:///dnbm/" })).toThrow(
      "HTTP or HTTPS",
    );
    expect(() => mountDnbmPlayer(container, { assetsUrl: "/dnbm/#top" })).toThrow(
      "without a query",
    );
  });
});

/** Serves directories over HTTP by path prefix, mapping directory URLs to index.html. */
function serve(
  routes: Record<string, string>,
  { hostname = "127.0.0.1", headers = {} }: { hostname?: string; headers?: HeadersInit } = {},
) {
  return Bun.serve({
    hostname,
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      const prefix = Object.keys(routes)
        .filter((candidate) => path.startsWith(candidate))
        .sort((a, b) => b.length - a.length)[0];
      const directory = prefix === undefined ? undefined : routes[prefix];
      if (prefix === undefined || directory === undefined) {
        return new Response("Not found", { status: 404, headers });
      }
      const relative = path.slice(prefix.length);
      const file = Bun.file(
        join(
          directory,
          relative === "" || relative.endsWith("/") ? `${relative}index.html` : relative,
        ),
      );
      return file.size > 0
        ? new Response(file, { headers })
        : new Response("Not found", { status: 404, headers });
    },
  });
}

/** What the host page below exposes to the tests. */
interface HostWindow {
  dnbm: typeof import("../src/index");
  // Not "player": the window already names the element with that id.
  sequencerApp: DnbmInstance | undefined;
  playerApp: DnbmInstance | undefined;
  mountSequencer(): Promise<void>;
  mountPlayer(): Promise<void>;
  contexts: AudioContext[];
  /** Calls to resume an audio context that was already closed. */
  resumedClosed: number;
  workers: { terminated: boolean }[];
  frames: number;
  /** The shadow root of the app in the container with this id. */
  shadow(id: string): ShadowRoot;
  firstReady: string;
}

// A plain host page, as a2f0.net's experiment is: it imports the package's module and
// serves the copied assets from its own origin. Its own styles would restyle the app if
// they reached it, and its own elements share the app's class names.
const HOST_PAGE = `<!doctype html><meta charset="utf-8"><title>host</title>
<style>
  body { margin: 0; font: italic 30px serif; letter-spacing: 4px; color: #777777; }
  * { line-height: 3; text-transform: uppercase; --bg: #ffffff; --faint: #000000; --fill: 50%; }
  div { font: italic 30px serif; color: #777777; background: #ffffff; word-spacing: 9px; }
  button { background: #ffffff; font-size: 30px; }
  .cell, .track { display: none; }
  #window, #player { float: left; direction: rtl; }
</style>
<input id="outside" aria-label="outside">
<button class="play" id="host-play">host</button>
<div id="window" style="width:1200px;height:800px"></div>
<div id="player" style="width:440px;height:420px"></div>
<script type="module">
  import * as dnbm from "/lib/index.js";
  window.dnbm = dnbm;
  window.mountSequencer = () => {
    window.sequencerApp?.destroy();
    window.sequencerApp = dnbm.mountDnbm(document.getElementById("window"), { assetsUrl: "/dnbm/" });
    return window.sequencerApp.ready;
  };
  window.mountPlayer = () => {
    window.playerApp?.destroy();
    window.playerApp = dnbm.mountDnbmPlayer(document.getElementById("player"), {
      assetsUrl: "/dnbm/",
      songs: ["/dnbm/songs/wraith.dnbm.json", "/dnbm/songs/undertow.dnbm.json"],
    });
    return window.playerApp.ready;
  };
</script>`;

/**
 * Runs in the host page before its scripts: records the audio contexts and animation
 * frames the apps start, and hides the File System Access pickers, which headless
 * Chrome can't answer, so saving and opening take their fallbacks.
 */
function instrument(): void {
  const host = window as unknown as HostWindow;
  host.contexts = [];
  host.resumedClosed = 0;
  host.workers = [];
  host.frames = 0;
  host.shadow = (id) => {
    const root = document.querySelector(`#${id} > div`)?.shadowRoot;
    if (!root) throw new Error(`no app in #${id}`);
    return root;
  };
  const NativeAudioContext = AudioContext;
  window.AudioContext = class extends NativeAudioContext {
    constructor(options?: AudioContextOptions) {
      super(options);
      host.contexts.push(this);
    }
    override resume(): Promise<void> {
      if (this.state === "closed") host.resumedClosed += 1;
      return super.resume();
    }
  };
  const NativeWorker = Worker;
  window.Worker = class extends NativeWorker {
    private readonly record = { terminated: false };
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      host.workers.push(this.record);
    }
    override terminate(): void {
      this.record.terminated = true;
      super.terminate();
    }
  };
  const nativeFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    host.frames += 1;
    return nativeFrame(callback);
  };
  for (const name of ["showOpenFilePicker", "showSaveFilePicker"]) {
    Object.defineProperty(window, name, { value: undefined, configurable: true });
  }
}

// The packaged apps in a real browser, mounted into a host page's own document. Needs
// Google Chrome, as on GitHub's runners.
describe("the packaged app mounted in a host page", () => {
  let browser: Browser;
  let page: Page;
  let server: ReturnType<typeof serve>;
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
    const host = join(temporary, "host");
    await copyAssets(join(host, "dnbm"));
    await writeFile(join(host, "index.html"), HOST_PAGE);
    server = serve({ "/lib/": join(installed, "lib"), "/": host });
    // No autoplay override: audio must start from a click inside the app.
    browser = await chromium.launch({ channel: "chrome", headless: true });
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1700, height: 900 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(instrument);
    await page.goto(server.url.href);
    await page.evaluate(() => (window as unknown as HostWindow).mountSequencer());
    sequencer = page.locator("#window");
    player = page.locator("#player");
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.stop(true);
  });

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
    const fresh = await browser.newPage({ viewport: { width: 1700, height: 900 } });
    try {
      await fresh.addInitScript(instrument);
      const released = Promise.withResolvers<void>();
      await fresh.route("**/dnbm/mount.js", async (route) => {
        await released.promise;
        await route.continue();
      });
      await fresh.goto(server.url.href);
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

// The packaged apps with their assets on another origin, which serves them with CORS.
describe("the packaged app with its assets on another origin", () => {
  let browser: Browser;
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
    browser = await chromium.launch({ channel: "chrome", headless: true });
    page = await browser.newPage({
      acceptDownloads: true,
      viewport: { width: 1280, height: 1300 },
    });
    await page.addInitScript(instrument);
    await page.goto(hostServer.url.href);
    await page.locator("#window .cell").first().waitFor();
    await page.locator("#player .track").first().waitFor();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    for (const server of servers) await server.stop(true);
  });

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

// The site's own pages, as dnbm.a2f0.net serves them: under its content security
// policy, they mount the apps through the same shell and app modules as a host.
describe("the packaged site's own pages", () => {
  let browser: Browser;
  let server: ReturnType<typeof serve>;

  beforeAll(async () => {
    const text = await readFile(join(ROOT, "packages", "sequencer", "_headers"), "utf8");
    const headers: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const match = /^\s+([\w-]+):\s*(.+)$/.exec(line);
      if (match?.[1] && match[2]) headers[match[1]] = match[2];
    }
    expect(headers["Content-Security-Policy"]).toContain("style-src 'self'");
    server = serve({ "/": join(installed, "site") }, { headers });
    browser = await chromium.launch({ channel: "chrome", headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.stop(true);
  });

  /** Opens a page, collecting errors and content security policy violations. */
  async function open(path: string): Promise<{ page: Page; problems: string[] }> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    await page.goto(new URL(path, server.url).href);
    return { page, problems };
  }

  test("the sequencer shows its wordmark, titles the page with the song, and plays", async () => {
    const { page, problems } = await open("/");
    try {
      await page.locator(".cell").first().waitFor();
      expect(await page.locator(".brand").isVisible()).toBe(true);
      expect(await page.title()).toBe("Undertow · dnbm");
      await page.locator(".play").click();
      await page.locator(".cell.now").first().waitFor({ timeout: 10_000 });
      await page.locator('.grid-row[data-track="0"] .cell').nth(1).click();
      expect(await page.title()).toBe("● Undertow · dnbm");
      expect(problems).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);

  test("the player lists every example song and plays one", async () => {
    const { page, problems } = await open("/player/");
    try {
      await page.locator(".track").first().waitFor();
      expect(await page.locator(".bar").isVisible()).toBe(true);
      expect(await page.locator(".track").count()).toBeGreaterThan(1);
      await page.locator(".control.play").click();
      const time = await page.waitForSelector(".time");
      await page.waitForFunction((element) => element.textContent !== "0:00", time, {
        timeout: 15_000,
      });
      expect(problems).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);
});
