# The `@a2f0/dnbm` package

`@a2f0/dnbm` embeds the complete sequencer, or the player, in another page or app,
such as a mini-app window. The app renders into the host's own document, inside a
shadow root that keeps its styles and the host's apart. It is plain ESM with
TypeScript declarations; consumers need neither Bun nor Rust, and installing it runs
no scripts.

```sh
bun add --exact @a2f0/dnbm
# or
npm install --save-exact @a2f0/dnbm
```

## Copy the app's assets

The app is a set of static files: its code (`mount.js`, and `player/mount.js` for
the player), its stylesheets, an AudioWorklet, a WAV export worker, the WebAssembly
engine and the example songs, along with the site's own pages. Copy them into a
directory your host serves, from a Node 22+ or Bun build script:

```ts
import { copyDnbmAssets } from "@a2f0/dnbm/build";

await copyDnbmAssets("./public/dnbm");
```

Serve that directory over HTTP, keeping its relative paths, and pass its URL to the
mount functions: the app loads everything from there, so any path works. The helper
adds files and clears nothing: give it a dedicated directory, and clear it first to
drop files an upgrade removed. Keep the copy out of Git, and copy it again whenever
you upgrade the package, so the code you bundle and the code you serve match.

## Mount it

```ts
import { mountDnbm } from "@a2f0/dnbm";

const dnbm = mountDnbm(container, { assetsUrl: "/dnbm/" });
await dnbm.ready; // optional: the app shows

// When the component leaves:
dnbm.destroy();
```

`mountDnbm` returns at once with an instance:

- `element` is the `HTMLElement` it appended to `container`: a region named by the
  `title` option (default "dnbm drum and bass sequencer"), with the app in its open
  shadow root. It fills the container, which sets the app's size and placement: give
  the container an explicit height. The app is laid out for about 1200 by 800 pixels;
  a shorter container scrolls the app, and one 720 pixels wide or less stacks its
  panels.
- `ready` resolves once the app shows, styled and laid out: use it where an iframe's
  `load` event was used, for example to fit a window to the app. It rejects when the
  app can't start, as when its assets fail to load, and the element then says why;
  the error is also logged, so a host that ignores `ready` sees no unhandled
  rejection. A destroyed instance's `ready` never settles, as a removed frame never
  loads.
- `destroy()` removes the element and releases everything the app holds: its audio
  context, worker, listeners, timers and animation frames. Calling it again does
  nothing, and destroying while the app still loads is safe. Unlike a frame, the app
  doesn't stop when its element merely leaves the page: always call `destroy`.
- `run`, `state` and `subscribe` let the host's own controls drive the app: see
  [Drive it from the host's controls](#drive-it-from-the-hosts-controls).

Embedding hides the dnbm wordmark, since the host names the app; pass
`branding: true` to show it. Importing the module never touches the DOM, so server
rendering and lazy loading are safe.

Audio starts on the first press inside the app, or on a command the host runs from
a press, as browsers require. The app takes the keyboard only while focus is inside
it, and a press anywhere in it gives it focus: keys pressed elsewhere on the host
page, or in another app, never reach its shortcuts. Presses and keys still bubble out
of it to the host, so a host's window can raise itself on a press inside the app, and
the host's `pointerdown` and `mousedown` listeners hear every press, including one
that paints steps or turns a knob, so a host's open menu closes. A key the app acts
on arrives with `defaultPrevented` set, so a host's own shortcuts can leave it alone. The app scrolls
only its own panels, never the host page. Confirmations and prompts open inside the
app, over the app only, and the rest of the host page stays usable.

In a React component, an effect owns the lifecycle. Mounting is synchronous, so React
Strict Mode's mount, destroy and mount again in development works:

```tsx
useEffect(() => {
  const dnbm = mountDnbm(host.current!, { assetsUrl: "/dnbm/" });
  dnbm.ready.then(fit, fit); // fit the window to the app, whether or not it started
  return () => dnbm.destroy();
}, []);
```

### How the app's code loads

The package's module (`lib/`) is a small loader that a host bundles. When it mounts,
it imports the app's code from the assets (`mount.js`) with a dynamic `import()` that
carries `webpackIgnore`, `turbopackIgnore` and `@vite-ignore` comments, so webpack
(including Next.js with `--webpack`), Turbopack and Vite leave it to the browser;
Rollup, esbuild and Bun leave an import of a variable alone anyway. A bundler that
tried to resolve it would fail to build: tell it to ignore that import. The host's
bundle stays small, and the app's code loads only when an app mounts, once per page.

### Storage

The sequencer autosaves the open song to the host page's local storage under
`dnbm:song` and `dnbm:saved`, the keys earlier versions used, so a song autosaved by
an earlier version on the same origin still opens. Every embed on that origin shares
one autosaved song, and the host's pages can read it. The player stores nothing.

### Content security policy and other origins

The app runs in the host's page, under the host's content security policy. A host
with one must allow the assets' origin (usually `'self'`) in `script-src`,
`style-src`, `worker-src` and `connect-src`, and `'wasm-unsafe-eval'` in `script-src`,
since the AudioWorklet compiles WebAssembly.

Serve the assets from the host's origin when you can. Assets on another origin work
when that origin allows the page's origin through CORS (`Access-Control-Allow-Origin`)
on every file, since the page imports the code and fetches the engine and songs
itself; browsers start workers only from the page's origin, so the WAV export then
starts its worker through a `blob:` URL, which `worker-src` must allow. The app's code
runs with the host page's privileges wherever it is served from: serve it only from
an origin you trust.

## Mount the player

The same assets hold the player, which plays a playlist of songs and edits nothing:
a display with elapsed time and a spectrum, seek, shuffle, repeat and volume.

```ts
import { mountDnbmPlayer } from "@a2f0/dnbm";

const player = mountDnbmPlayer(container, {
  assetsUrl: "/dnbm/",
  songs: ["/dnbm/songs/wraith.dnbm.json", "/dnbm/songs/undertow.dnbm.json"],
});

// When the component leaves:
player.destroy();
```

`songs` lists song files in playing order; relative URLs resolve against the host
page. Without it, the player lists every example song the assets hold. The page
fetches the songs, so a song on another origin must allow the page's origin through
CORS. `assetsUrl`, `title` (default "dnbm player") and `branding` work as for
`mountDnbm`, and the returned instance is the same; its `ready` resolves once the
songs have loaded and the player shows. Embedded, the player fills its container and
its playlist takes whatever height the rest leaves, so any size around 440 by 420
pixels or more suits it.

The sequencer and the player can run side by side on one page, each with its own
audio context, and as many instances of each as a host likes.

Asset files are also reachable as `@a2f0/dnbm/assets/<path>` for tooling that
resolves package files directly. Songs saved from an embedded app are ordinary
song files; [the song format](song-format.md) describes them.

## Drive it from the host's controls

A host with its own controls, such as a desktop window's File menu, toolbar and
status bar, drives the app through its instance, never through its shadow root or
class names. Each instance has three more members:

- `run(command)` carries out a command, as its button or shortcut in the app would,
  and returns `true`; or it does nothing and returns `false` when the command isn't
  available now.
- `state` is the app's state now: a frozen snapshot, which a change replaces with a
  new object and which otherwise stays the same object, so it suits React's
  `useSyncExternalStore`.
- `subscribe(listener)` calls `listener` with the new state after each change, until
  the function it returns is called or the instance is destroyed.

`subscribe` and `run` don't use `this`, so they can be passed on as they are.

| Sequencer command | Does what |
| --- | --- |
| `play`, `stop` | Plays the song from where play starts, or stops it |
| `togglePlay` | Plays or stops, as Space does |
| `new` | Starts a new song, after asking to discard unsaved changes |
| `open` | Opens a song file, after asking to discard unsaved changes (⌘O) |
| `save` | Saves to the file the song came from, or asks where (⌘S) |
| `saveAs` | Saves to a new file (⇧⌘S) |
| `export` | Renders the song to a WAV file and downloads it |
| `undo`, `redo` | Undoes or redoes an edit (⌘Z, ⇧⌘Z) |

| Player command | Does what |
| --- | --- |
| `play` | Plays the current song, or resumes a paused one (X) |
| `pause` | Pauses (C) |
| `togglePlay` | Plays or pauses, as Space does |
| `stop` | Stops, back to the start of the song (V) |
| `previous`, `next` | Moves to the previous or next song, playing it if playing; past a song's first three seconds, `previous` restarts it (Z, B) |
| `toggleShuffle`, `toggleRepeat` | Turns shuffle or repeat on or off (S, R) |

The sequencer's state (`DnbmSequencerState`) holds `playing`, the song's `title`, the
`fileName` it opened from or saves to, `dirty` for unsaved changes, and `available`,
whether `run` takes each command now. The player's (`DnbmPlayerState`) holds
`playing`, `paused`, the current song's `title`, `shuffle`, `repeat`, and `available`.
A command is unavailable when it doesn't apply, as `play` while playing, `stop` while
stopped or `undo` with nothing to undo; while the sequencer asks something in a
dialog, none is, as the app behind the dialog takes no input.

The instance's lifetime bounds all of it:

- Before `ready`, nothing in `state` plays, no command is available, and `run`
  returns `false`. A listener subscribed then hears the app's state at `ready`.
- Listeners hear of changes in a microtask, never inside the app's own code, and
  once for several changes made together. A listener that throws is reported, as an
  event listener's error is, and the others still hear.
- `destroy()` ends every subscription without a last call, returns `state` to the
  idle state from before `ready`, and makes `run` return `false`. Work a command
  started stops as it would from the app's own button: a dialog closes unanswered, a
  file picked or saved afterwards is neither opened nor written, an export downloads
  nothing, and audio stays closed. A subscription made after `destroy()` does nothing.
- If the app can't start, its state stays idle.

`open`, `save` and `saveAs` open a file picker, which browsers allow only with a user
activation: run them from the host's own click or key handler, not after an `await`
or a timer. A confirmation the app shows first gets its activation from the user's
press on it. Where the page has no File System Access pickers, or refuses them, open
falls back to a file input and save to a download, as in the app. Running a command
leaves the keyboard where it is; the app's shortcuts still work once a press puts
focus inside it.

Pass `actions: false` to leave out the app's own buttons for these commands when the
host shows them, so none shows twice: in the sequencer's top bar, play, new, open,
save, export, undo and redo; in the player, previous, play, pause, stop, next,
shuffle and repeat. Everything else stays, and closes up: the song's title, play
mode, tempo, swing, position, scope and example songs in the sequencer's top bar,
and the display, seek and volume in the player. Keyboard shortcuts keep working.

In React, an effect mounts the app, and `useSyncExternalStore` follows its state:

```tsx
const [dnbm, setDnbm] = useState<DnbmSequencerInstance | null>(null);
useEffect(() => {
  const instance = mountDnbm(host.current!, { assetsUrl: "/dnbm/", actions: false });
  setDnbm(instance);
  return () => instance.destroy();
}, []);

const subscribe = useCallback(
  (onChange: () => void) => dnbm?.subscribe(onChange) ?? (() => {}),
  [dnbm],
);
const state = useSyncExternalStore(subscribe, () => dnbm?.state ?? null);

// A toolbar button, a menu item and a title, from the state alone:
<button disabled={!state?.available.togglePlay} onClick={() => dnbm?.run("togglePlay")}>
  {state?.playing ? "Stop" : "Play"}
</button>;
<MenuItem label="Save" disabled={!state?.available.save} onClick={() => dnbm?.run("save")} />;
const title = state && `${state.dirty ? "● " : ""}${state.title}`;
```

`mountDnbm` returns a `DnbmSequencerInstance` and `mountDnbmPlayer` a
`DnbmPlayerInstance`; `DnbmInstance` is still the part they share. The commands
live in the app's code in the assets, so copy the assets again when upgrading: an
app module from before 0.4 takes no commands, and its state stays idle.

## From 0.2 (iframes) to 0.3

Before 0.3, the app ran in an iframe. Hosts upgrading:

- `element` is the app's region element, not an `HTMLIFrameElement`: wait for `ready`
  instead of the frame's `load` event, and reach the app through
  `element.shadowRoot` instead of `contentDocument`. Embedded, the app's `.frame`
  element carries `data-embed`, which the frame's document element used to.
- The app's styles no longer reach outside its shadow root, and the host's no longer
  reach in; nothing inherited from the host's elements does either.
- Presses inside the app reach the host's window as any other press does, so a
  workaround that raised a window when a frame took focus is no longer needed.
- Copy the assets again: the app's code is new files (`mount.js`,
  `player/mount.js`).

## Releases

ship-pr bumps `package.json`'s patch version on every merge, and the
[publish workflow](../.github/workflows/npm-publish.yml) publishes each version
newer than npm's `latest` with [trusted publishing](https://docs.npmjs.com/trusted-publishers)
and provenance. No npm token is stored: the publish job runs in the `npm` GitHub
environment, which only `main` can deploy to, and npm's trusted publisher names
that environment and `npm-publish.yml`. The workflow runs the full `bun run check`
first, then builds and packs the tarball without publish rights; the publish job
receives only that tarball. A deliberate minor or major bump in a PR is kept.

npm adds a trusted publisher only to a package that already exists, so the first
version is published by hand from an up-to-date `main`. Until then the workflow
fails with that instruction:

```sh
npm login
npm publish   # prepublishOnly runs bun run check; prepack builds lib/ and site/
```

Then, in the package's settings on npmjs.com, add a GitHub Actions trusted
publisher for repository `a2f0/dnbm`, workflow `npm-publish.yml` and environment
`npm`, and re-run the workflow; it reports the version as already published.

`bun run build:package` builds the package locally (into `lib/` and `site/`), and
`npm pack` builds and packs it. The site at dnbm.a2f0.net deploys separately
(see [deploying](deploying.md)).
