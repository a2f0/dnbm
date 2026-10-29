// What the package suites share: the package packed as npm publishes it and installed
// in a consumer, the host page they mount it in, and one Chrome. Each is made once per
// test process, by whichever suite asks first, and torn down once the run ends
// (test/support/teardown.ts). Run the suites in one process (plain `bun test`): each
// `--parallel` worker would pack again, and packing builds into the repository.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright-core";
import { buildPackage } from "../../scripts/build/buildPackage";
import { closeChrome, launchChrome } from "../../scripts/testing/chrome";
import type {
  DnbmOptions,
  DnbmPlayerInstance,
  DnbmPlayerOptions,
  DnbmSequencerInstance,
} from "../../src/index";
import { onTeardown } from "../support/teardown";

export const ROOT = join(import.meta.dir, "..", "..");

/** How long a suite's setup may take, packing the package if it is the first. */
export const SETUP_TIMEOUT = 180_000;

export interface Packed {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

export interface Packaged {
  /** A temporary directory the suites write into, removed at teardown. */
  readonly temporary: string;
  /** A consumer package with `@a2f0/dnbm` installed from the tarball. */
  readonly consumer: string;
  /** Where the tarball's contents are installed. */
  readonly installed: string;
  /** What `npm pack` reports. */
  readonly packed: Packed;
}

let packaging: Promise<Packaged> | undefined;

/** Packs @a2f0/dnbm exactly as npm publishes it and installs the tarball in a consumer. */
export function packedPackage(): Promise<Packaged> {
  packaging ??= pack();
  return packaging;
}

async function pack(): Promise<Packaged> {
  const temporary = await mkdtemp(join(tmpdir(), "dnbm-package-"));
  onTeardown(async () => {
    packaging = undefined;
    hosting = undefined;
    await rm(temporary, { recursive: true, force: true });
  });
  await buildPackage();
  const consumer = join(temporary, "consumer");
  const installed = join(consumer, "node_modules", "@a2f0", "dnbm");
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
  const [packed] = JSON.parse(output) as [Packed];
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
  return { temporary, consumer, installed, packed };
}

/** Copies the installed package's assets with its own `copyDnbmAssets`, as a host would. */
export async function copyAssets(destination: string): Promise<void> {
  const { installed } = await packedPackage();
  const { copyDnbmAssets } = (await import(
    pathToFileURL(join(installed, "lib", "build.js")).href
  )) as { copyDnbmAssets: (destination: string) => Promise<void> };
  await copyDnbmAssets(destination);
}

let launching: Promise<Browser> | undefined;

/**
 * The run's Chrome, launched on first use. Each suite opens its own contexts in it and
 * closes them when it ends; Chrome closes at teardown. Needs Google Chrome, as on
 * GitHub's runners.
 */
export function sharedChrome(): Promise<Browser> {
  if (!launching) {
    const browser = launchChrome();
    launching = browser;
    // A failed launch fails the suite that asked; the next suite tries again.
    browser.catch(() => {
      if (launching === browser) launching = undefined;
    });
    onTeardown(async () => {
      if (launching === browser) launching = undefined;
      await closeChrome(await browser.catch(() => undefined));
    });
  }
  return launching;
}

/** Serves directories over HTTP by path prefix, mapping directory URLs to index.html. */
export function serve(
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
export interface HostWindow {
  dnbm: typeof import("../../src/index");
  // Not "player": the window already names the element with that id.
  sequencerApp: DnbmSequencerInstance | undefined;
  playerApp: DnbmPlayerInstance | undefined;
  mountSequencer(options?: Partial<DnbmOptions>): Promise<void>;
  mountPlayer(options?: Partial<DnbmPlayerOptions>): Promise<void>;
  /** What the host's own button (#host-play) does when pressed. */
  hostAction: (() => unknown) | undefined;
  /** Where the host's document-level `mousedown` listener heard each press: an id. */
  mousedowns: string[];
  /** What the last command the host's button ran returned. */
  ran: boolean | undefined;
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
<div id="below" style="clear:both;height:3000px"></div>
<script type="module">
  import * as dnbm from "/lib/index.js";
  window.dnbm = dnbm;
  window.mountSequencer = (options = {}) => {
    window.sequencerApp?.destroy();
    window.sequencerApp = dnbm.mountDnbm(document.getElementById("window"), {
      assetsUrl: "/dnbm/",
      ...options,
    });
    return window.sequencerApp.ready;
  };
  window.mountPlayer = (options = {}) => {
    window.playerApp?.destroy();
    window.playerApp = dnbm.mountDnbmPlayer(document.getElementById("player"), {
      assetsUrl: "/dnbm/",
      songs: ["/dnbm/songs/wraith.dnbm.json", "/dnbm/songs/undertow.dnbm.json"],
      ...options,
    });
    return window.playerApp.ready;
  };
  // The host's own control, which a test points at the apps' commands, and its
  // document-level mousedown listener, as a host's open menus close on.
  document.getElementById("host-play").addEventListener("click", () => window.hostAction?.());
  window.mousedowns = [];
  document.addEventListener("mousedown", (event) => {
    window.mousedowns.push(event.target instanceof Element ? event.target.closest("[id]")?.id ?? "" : "");
  });
</script>`;

/**
 * Runs in the host page before its scripts: records the audio contexts and animation
 * frames the apps start, and hides the File System Access pickers, which headless
 * Chrome can't answer, so saving and opening take their fallbacks.
 */
export function instrument(): void {
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

let hosting: Promise<string> | undefined;

/** The host page's directory, with the assets copied beside it: made once, read-only. */
function hostDirectory(): Promise<string> {
  hosting ??= (async () => {
    const { temporary } = await packedPackage();
    const host = join(temporary, "host");
    await copyAssets(join(host, "dnbm"));
    await writeFile(join(host, "index.html"), HOST_PAGE);
    return host;
  })();
  return hosting;
}

/** The host page open in a context of its own in the shared Chrome. */
export interface HostPage {
  readonly browser: Browser;
  readonly page: Page;
  /** The host page's address. */
  readonly url: string;
  /** Closes the page's context and stops its server. */
  close(): Promise<void>;
}

/**
 * Serves the host page and opens it, instrumented, collecting its page errors in
 * `errors`. No autoplay override: audio must start from a click inside the app.
 */
export async function openHostPage(errors: string[]): Promise<HostPage> {
  const { installed } = await packedPackage();
  const server = serve({ "/lib/": join(installed, "lib"), "/": await hostDirectory() });
  const close = async (context?: { close(): Promise<void> }) => {
    try {
      await context?.close();
    } finally {
      await server.stop(true);
    }
  };
  let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
  try {
    const browser = await sharedChrome();
    context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1700, height: 900 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(instrument);
    await page.goto(server.url.href);
    const opened = context;
    return { browser, page, url: server.url.href, close: () => close(opened) };
  } catch (error) {
    await close(context);
    throw error;
  }
}
