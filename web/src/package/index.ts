// The browser entrypoint of the @a2f0/dnbm package: mounts the complete app in a
// host-owned container. Importing it never touches the DOM, so server rendering and
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
  /** The app's frame. Its styles, audio engine and storage stay apart from the host's. */
  readonly element: HTMLIFrameElement;
  /** Removes the app, releasing its document, audio context and event handlers. */
  destroy(): void;
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
  const document = container.ownerDocument;
  const base = new URL(assetsUrl, document.baseURI);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new TypeError("dnbm assets must be served over HTTP or HTTPS.");
  }
  if (base.search || base.hash) {
    throw new TypeError("dnbm's assetsUrl must be a directory URL without a query or fragment.");
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";

  const app = new URL("index.html", base);
  if (!branding) app.searchParams.set("embed", "1");
  const element = document.createElement("iframe");
  element.title = title;
  element.src = app.href;
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
