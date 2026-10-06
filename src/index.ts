// The browser entrypoint of the @a2f0/dnbm package: mounts the sequencer or the player
// in a host-owned container. Importing it never touches the DOM, so server rendering and
// lazy loading are safe. docs/package.md describes the package.

export interface DnbmOptions {
  /**
   * The directory serving the app's assets, as copied by `copyDnbmAssets` from
   * `@a2f0/dnbm/build`; for example "/dnbm/". Relative URLs resolve against the page.
   */
  readonly assetsUrl: string | URL;
  /** The frame's accessible title. */
  readonly title?: string;
  /**
   * Show the dnbm wordmark in the app's top bar. Hidden by default, as a host's
   * window or page already names the app.
   */
  readonly branding?: boolean;
}

export interface DnbmInstance {
  /**
   * The app's frame, which keeps its styles and scripts apart from the host page. Served
   * from the host's origin, it shares that origin's local storage (see docs/package.md).
   */
  readonly element: HTMLIFrameElement;
  /** Removes the app, releasing its document, audio context and event handlers. */
  destroy(): void;
}

export interface DnbmPlayerOptions extends DnbmOptions {
  /**
   * The playlist: song files (`.dnbm.json`) in playing order. Relative URLs resolve
   * against the page, and the frame fetches them, so they must be readable from the
   * assets' origin. Defaults to every example song the assets hold.
   */
  readonly songs?: readonly (string | URL)[];
}

/** The validated, slash-terminated directory the assets are served from. */
function assetsBase(document: Document, assetsUrl: string | URL): URL {
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

function mountFrame(container: HTMLElement, page: URL, title: string): DnbmInstance {
  const element = container.ownerDocument.createElement("iframe");
  element.title = title;
  element.src = page.href;
  // Audio starts from a gesture inside the frame; delegating autoplay keeps that
  // working when the assets are served from another origin.
  element.allow = "autoplay";
  element.style.cssText = "display:block;width:100%;height:100%;border:0";
  container.append(element);
  return {
    element,
    destroy() {
      element.remove();
    },
  };
}

/**
 * Mounts the dnbm sequencer in an iframe filling `container`. The container sets the
 * app's size and placement: give it an explicit height. Call `destroy` when the
 * hosting component leaves.
 */
export function mountDnbm(
  container: HTMLElement,
  { assetsUrl, title = "dnbm drum and bass sequencer", branding = false }: DnbmOptions,
): DnbmInstance {
  const page = new URL("index.html", assetsBase(container.ownerDocument, assetsUrl));
  if (!branding) page.searchParams.set("embed", "1");
  return mountFrame(container, page, title);
}

/**
 * Mounts the dnbm player, which plays a playlist of songs and edits nothing, in an
 * iframe filling `container`, from the same assets as `mountDnbm`. The container sets
 * its size: give it an explicit height. Call `destroy` when the hosting component
 * leaves.
 */
export function mountDnbmPlayer(
  container: HTMLElement,
  { assetsUrl, title = "dnbm player", branding = false, songs }: DnbmPlayerOptions,
): DnbmInstance {
  const document = container.ownerDocument;
  const page = new URL("player/index.html", assetsBase(document, assetsUrl));
  if (!branding) page.searchParams.set("embed", "1");
  for (const song of songs ?? []) {
    page.searchParams.append("song", new URL(song, document.baseURI).href);
  }
  return mountFrame(container, page, title);
}
