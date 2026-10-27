# dnbm sequencer

The dnbm editor and mixer: program patterns on a step grid, arrange them into a song and
mix them. The sequencer is available on the web at <https://dnbm.a2f0.net>, the site's
root, and other pages embed it with `mountDnbm` from the
[`@a2f0/dnbm` package](../../docs/package.md). It is a private workspace package,
TypeScript and DOM with no framework, built on the shared synthesizer in `packages/synth`.

Run it from the repository root with `bun run dev` (`http://localhost:8174`); the
[root README](../../README.md#quick-start) has the setup.

## Using the editor

The editor opens on **Undertow**. Press space to play. The browser restores your last
session; choose Undertow from **examples** to reload the bundled song. The same menu
holds the other [example songs](../../README.md#songs).

Click an arrangement slot to start there, or choose **loop** to work on one pattern.
**follow** keeps the grid on the playing pattern; selecting another pattern during
song playback turns follow off so you can edit ahead. Muted channels and channels
excluded by solo dim in the mixer. The master holds its highest peak in dBFS; click
that reading to reset it, or start playback for a fresh reading.

[Architecture](../../docs/architecture.md#the-sequencer-packagessequencer) describes how
the editor is built.
