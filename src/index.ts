// The browser entrypoint of the @a2f0/dnbm package: mounts the sequencer or the player
// in a host-owned container, inside a shadow root in the host's own document. Importing
// it never touches the DOM, so server rendering and lazy loading are safe.
// docs/package.md describes the package.

// The emitted modules keep these paths, so they name the files browsers and Node load.
import {
  type DnbmPlayerInstance,
  type DnbmSequencerInstance,
  mountApp,
  PLAYER,
  SEQUENCER,
} from "./shell.js";

export type {
  DnbmPlayerCommand,
  DnbmPlayerState,
  DnbmSequencerCommand,
  DnbmSequencerState,
} from "./control.js";
export type {
  DnbmControls,
  DnbmInstance,
  DnbmPlayerInstance,
  DnbmSequencerInstance,
} from "./shell.js";

export interface DnbmOptions {
  /**
   * The directory serving the app's assets, as copied by `copyDnbmAssets` from
   * `@a2f0/dnbm/build`; for example "/dnbm/". Relative URLs resolve against the page.
   * The app's code, stylesheet, AudioWorklet, engine and example songs load from it.
   */
  readonly assetsUrl: string | URL;
  /** The app's accessible name: `element` is a region with this label. */
  readonly title?: string;
  /**
   * Show the dnbm wordmark in the app's top bar. Hidden by default, as a host's
   * window or page already names the app.
   */
  readonly branding?: boolean;
  /**
   * Show the app's own buttons for the commands its instance's `run` takes: in the
   * sequencer's top bar, play, new, open, save, export, undo and redo; in the player,
   * previous, play, pause, stop, next, shuffle and repeat. True by default. Pass false
   * when the host shows those commands itself, as in its window's menus and toolbar, so
   * they don't show twice; the rest of the app, and its keyboard shortcuts, stay.
   */
  readonly actions?: boolean;
}

export interface DnbmPlayerOptions extends DnbmOptions {
  /**
   * The playlist: song files (`.dnbm.json`) in playing order. Relative URLs resolve
   * against the page, which fetches them, so a song on another origin must allow the
   * page's origin through CORS. Defaults to every example song the assets hold.
   */
  readonly songs?: readonly (string | URL)[];
}

/**
 * Mounts the dnbm sequencer filling `container`, inside a shadow root. It returns at
 * once; `ready` settles when the app shows. The container sets the app's size and
 * placement: give it an explicit height. Call `destroy` when the hosting component
 * leaves. The instance's `run`, `state` and `subscribe` let a host drive the app from
 * its own controls.
 */
export function mountDnbm(
  container: HTMLElement,
  { assetsUrl, title = SEQUENCER.label, branding = false, actions = true }: DnbmOptions,
): DnbmSequencerInstance {
  return mountApp(container, {
    ...SEQUENCER,
    assetsUrl,
    label: title,
    embed: !branding,
    actions: actions !== false,
  });
}

/**
 * Mounts the dnbm player, which plays a playlist of songs and edits nothing, filling
 * `container`, from the same assets as `mountDnbm`. It returns at once; `ready`
 * settles when the player shows, with its songs loaded. The container sets its size:
 * give it an explicit height. Call `destroy` when the hosting component leaves. The
 * instance's `run`, `state` and `subscribe` let a host drive the player from its own
 * controls.
 */
export function mountDnbmPlayer(
  container: HTMLElement,
  { assetsUrl, title = PLAYER.label, branding = false, actions = true, songs }: DnbmPlayerOptions,
): DnbmPlayerInstance {
  const page = container.ownerDocument.baseURI;
  return mountApp(container, {
    ...PLAYER,
    assetsUrl,
    label: title,
    embed: !branding,
    actions: actions !== false,
    songs: songs?.map((song) => new URL(song, page).href),
  });
}
