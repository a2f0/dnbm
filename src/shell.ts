// Mounts an app from the assets into a shadow root in the host's document: the shell
// both public mounts (src/index.ts) and the site's own pages use. It validates the assets
// URL, makes the element and its shadow root, loads the app's stylesheet and its module
// from the assets, and owns the instance's lifetime. Importing it never touches the DOM.
//
// The app modules (packages/sequencer/src/mount.ts and packages/player/src/mount.ts,
// built to mount.js and player/mount.js) implement `AppModule`. They render only inside
// the root they are given, resolve every URL from `AppContext.assets`, and release what
// they hold when `AppContext.signal` aborts.

/** What an app module exports. */
export interface AppModule {
  /**
   * Renders the app into `root`, whose stylesheet has loaded, and settles once it shows:
   * a rejection is a failure to start, which the shell reports in `root`.
   */
  mount(root: ShadowRoot, context: AppContext): Promise<void> | void;
}

export interface AppContext {
  /** The slash-terminated directory the assets are served from. */
  readonly assets: URL;
  /**
   * Aborts when the instance is destroyed, or fails to start. The app then releases
   * everything it holds: its audio context, workers, listeners outside its root, timers
   * and animation frames. The shell removes the DOM.
   */
  readonly signal: AbortSignal;
  /** The host names the app, so it hides its wordmark and fills its container. */
  readonly embed: boolean;
  /** The player's playlist, as absolute URLs; undefined for every example song. */
  readonly songs?: readonly string[] | undefined;
  /** Receives the title the app gives its page as it changes, as "● Undertow · dnbm". */
  readonly onTitle?: ((title: string) => void) | undefined;
}

/** A mounted app. */
export interface DnbmInstance {
  /**
   * The element holding the app, appended to the container. The app renders into its
   * open shadow root, which keeps the app's styles and the host's apart. It is a region
   * named by the `title` option, filling the container.
   */
  readonly element: HTMLElement;
  /**
   * Resolves once the app shows, styled and laid out; replaces an iframe's `load` event.
   * Rejects when the app can't start, as when its assets fail to load, and the element
   * then says why. Stays pending if the instance is destroyed first.
   */
  readonly ready: Promise<void>;
  /**
   * Removes the app and releases its audio context, worker, listeners, timers and
   * animation frames. Calling it again does nothing.
   */
  destroy(): void;
}

/** Where an app's files are, relative to the assets, and its default accessible name. */
export interface AppFiles {
  readonly module: string;
  readonly stylesheet: string;
  readonly label: string;
}

export const SEQUENCER: AppFiles = {
  module: "mount.js",
  stylesheet: "styles.css",
  label: "dnbm drum and bass sequencer",
};

export const PLAYER: AppFiles = {
  module: "player/mount.js",
  stylesheet: "player/styles.css",
  label: "dnbm player",
};

export interface ShellOptions extends AppFiles, Pick<AppContext, "embed" | "songs" | "onTitle"> {
  /** The assets' directory; relative URLs resolve against the container's document. */
  readonly assetsUrl: string | URL;
}

/** The validated, slash-terminated directory the assets are served from. */
export function assetsBase(document: Document, assetsUrl: string | URL): URL {
  const base = new URL(assetsUrl, document.baseURI);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new TypeError("dnbm assets must be served over HTTP or HTTPS.");
  }
  if (base.search || base.hash) {
    throw new TypeError("dnbm's assetsUrl must be a directory URL without a query or fragment.");
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return base;
}

/**
 * Imports an app module from the assets. Hosts bundle this file, but the module is
 * served with the assets, so the comments ask webpack, Turbopack and Vite to leave the
 * import to the browser; Rollup, esbuild and Bun leave an import of a variable alone.
 */
function importApp(url: string): Promise<AppModule> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ /* turbopackIgnore: true */ url);
}

/** Resolves once `link` has loaded its stylesheet. */
function loaded(link: HTMLLinkElement): Promise<void> {
  return new Promise((resolve, reject) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error(`Couldn't load ${link.href}.`)), {
      once: true,
    });
  });
}

// Set on the element itself, where it outranks the host page's rules: `all: initial`
// keeps the host's rules for its elements (a `div` or `*` rule) off it, so nothing they
// set is inherited into the app, `direction` (which `all` leaves) keeps a right-to-left
// page from mirroring the apps' left-to-right layout, and the rest sizes it to fill the
// container.
const HOST_STYLE =
  "all:initial;direction:ltr;display:block;position:relative;isolation:isolate;width:100%;height:100%;overflow:hidden";

// The failure message's own look, since the app's stylesheet may be what failed.
const FAILURE_STYLE =
  "box-sizing:border-box;height:100%;margin:0;padding:24px;background:#0a0a0a;color:#8a8a8a;font:12px/1.4 ui-monospace,monospace";

/** Shows why the app couldn't start, in place of the app. */
function showFailure(root: ShadowRoot, error: unknown): void {
  const document = root.ownerDocument;
  const message = document.createElement("p");
  message.className = "failure";
  message.style.cssText = FAILURE_STYLE;
  message.setAttribute("role", "alert");
  message.textContent = `dnbm couldn't start: ${error instanceof Error ? error.message : String(error)}`;
  root.replaceChildren(...[...root.querySelectorAll("link")].filter((link) => link.sheet), message);
}

/**
 * Mounts an app in a new element appended to `container`, and returns at once: the
 * element is in place, and `ready` settles once the app shows.
 */
export function mountApp(container: HTMLElement, options: ShellOptions): DnbmInstance {
  const document = container.ownerDocument;
  const assets = assetsBase(document, options.assetsUrl);
  const element = document.createElement("div");
  element.style.cssText = HOST_STYLE;
  element.setAttribute("role", "region");
  element.setAttribute("aria-label", options.label);
  const root = element.attachShadow({ mode: "open" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL(options.stylesheet, assets).href;
  root.append(stylesheet);
  container.append(element);

  const controller = new AbortController();
  let destroyed = false;
  const context: AppContext = {
    assets,
    signal: controller.signal,
    embed: options.embed,
    songs: options.songs,
    onTitle: options.onTitle,
  };
  const ready = new Promise<void>((resolve, reject) => {
    Promise.all([importApp(new URL(options.module, assets).href), loaded(stylesheet)])
      .then(async ([app]) => {
        if (!destroyed) await app.mount(root, context);
      })
      .then(
        () => {
          if (!destroyed) resolve();
        },
        (error: unknown) => {
          if (destroyed) return;
          controller.abort(error);
          showFailure(root, error);
          console.error("dnbm couldn't start:", error);
          reject(error);
        },
      );
  });
  // The element and the console report a failure, so a host that ignores `ready` sees
  // no unhandled rejection.
  ready.catch(() => {});

  return {
    element,
    ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.abort(new DOMException("The dnbm instance was destroyed.", "AbortError"));
      element.remove();
    },
  };
}
