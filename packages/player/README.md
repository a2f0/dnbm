# dnbm player

A playlist player for dnbm songs, after the desktop players of old: elapsed or remaining
time, a spectrum, seek, shuffle, repeat and volume, with Z, X, C, V and B for previous,
play, pause, stop and next. The player is available on the web at
<https://dnbm.a2f0.net/player/>, where it plays the example songs. It plays through the
same engine as the editor and edits nothing.

Seeking and Previous/Next preserve pause: they select the song and arrangement
slot without starting audio. Play (X) or Pause (C) resumes from that selection;
clicking a playlist row explicitly plays it. While playing, navigation keeps
playing; while stopped, it stays stopped. While playing or paused, Previous
restarts the current song after its first three seconds; otherwise it selects
the preceding song.

Other pages embed it with `mountDnbmPlayer` from the `@a2f0/dnbm` package, passing any
list of song files as the playlist;
[the package guide](../../docs/package.md#mount-the-player) shows how. It is a private
workspace package built on the shared synthesizer in `packages/synth`.

Run it from the repository root with `bun run dev`
(`http://localhost:8174/player/`); the [root README](../../README.md#quick-start) has
the setup. [Architecture](../../docs/architecture.md#the-player-packagesplayer)
describes how the player is built.
