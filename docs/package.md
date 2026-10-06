# The `@a2f0/dnbm` package

`@a2f0/dnbm` embeds the complete sequencer in another page or app, such as a
mini-app window. It is plain ESM with TypeScript declarations; consumers need
neither Bun nor Rust, and installing it runs no scripts.

```sh
bun add --exact @a2f0/dnbm
# or
npm install --save-exact @a2f0/dnbm
```

## Copy the app's assets

The app is a static site: a page, its scripts, an AudioWorklet, the WebAssembly
engine and the example songs, and the player at `player/`, which plays songs through
the same engine. Copy it into a directory your host serves, from a
Node 22+ or Bun build script:

```ts
import { copyDnbmAssets } from "@a2f0/dnbm/build";

await copyDnbmAssets("./public/dnbm");
```

Serve that directory over HTTP, keeping its relative paths; the app loads
everything relative to its page, so any path works. The helper adds files and
clears nothing: give it a dedicated directory, and clear it first to drop files an
upgrade removed. Keep the copy out of Git.

The page compiles WebAssembly, so a host with a content security policy must allow
`'wasm-unsafe-eval'` in `script-src`, and `worker-src 'self'` for the AudioWorklet
and the WAV export worker.

## Mount it

```ts
import { mountDnbm } from "@a2f0/dnbm";

const dnbm = mountDnbm(container, { assetsUrl: "/dnbm/" });

// When the component leaves:
dnbm.destroy();
```

The app fills `container` through an iframe, which keeps its styles and scripts apart
from the host page; give the container an explicit height. Audio
starts on the first gesture inside the frame, as browsers require. Embedding hides
the dnbm wordmark, since the host names the app; pass `branding: true` to show it.
`title` sets the frame's accessible title. Importing the module never touches the
DOM, so server rendering and lazy loading are safe, and `destroy` releases the
frame's document and audio context.

The app autosaves the open song to local storage under `dnbm:song` and
`dnbm:saved`. Storage belongs to an origin, not a frame: served from the host's own
origin, as when copied into its static files, every embed on that origin shares one
autosaved song, and the host's pages can read it. Serve the assets from an origin of
their own to keep that storage apart.

In a React component, an effect owns the lifecycle:

```tsx
useEffect(() => {
  const dnbm = mountDnbm(host.current!, { assetsUrl: "/dnbm/" });
  return () => dnbm.destroy();
}, []);
```

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
page. Without it, the player lists every example song the assets hold. The frame
fetches the songs itself, so a song on another origin must allow the assets' origin
through CORS. `assetsUrl`, `title` and `branding` work as for `mountDnbm`, and the
returned instance is the same. Embedded, the player fills its container and its
playlist takes whatever height the rest leaves, so any size around 440 by 420 pixels
or more suits it; it stores nothing.

Asset files are also reachable as `@a2f0/dnbm/assets/<path>` for tooling that
resolves package files directly. Songs saved from an embedded app are ordinary
song files; [the song format](song-format.md) describes them.

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
