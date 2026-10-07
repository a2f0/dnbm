// The player's app module, built to player/mount.js in the site: the shell
// (src/shell.ts) imports it from the assets and mounts the player into a shadow root,
// for a host's `mountDnbmPlayer` and for the site's player page alike. It plays the
// songs it is given, or every example song the assets hold, and returns the control
// the host's commands go through.

import { parseSongText } from "@a2f0/dnbm-synth/song/format";
import type { Song } from "@a2f0/dnbm-synth/song/model";
import type { AppContext, AppControl } from "../../../src/shell";
import { h } from "./dom";
import { Player } from "./player";

/** An entry of songs/index.json, which scripts/build.ts writes. */
interface SongIndexEntry {
  readonly file: string;
  readonly title: string;
}

async function fetchText(url: string | URL, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status}).`);
  return response.text();
}

async function songUrls({ assets, songs, signal }: AppContext): Promise<readonly (string | URL)[]> {
  if (songs && songs.length > 0) return songs;
  const index = new URL("songs/index.json", assets);
  const entries = JSON.parse(await fetchText(index, signal)) as SongIndexEntry[];
  return entries.map(({ file }) => new URL(file, index));
}

async function loadSongs(context: AppContext): Promise<Song[]> {
  const urls = await songUrls(context);
  return Promise.all(urls.map(async (url) => parseSongText(await fetchText(url, context.signal))));
}

export async function mount(
  root: ShadowRoot,
  context: AppContext,
): Promise<AppControl | undefined> {
  const songs = await loadSongs(context);
  const { assets, signal, embed, actions, onState } = context;
  if (signal.aborted) return undefined;
  // The frame scrolls, sizes the layout, and takes focus on a press anywhere in the
  // player, so the player's shortcuts see its keys and no others.
  const frame = h("div", { class: "frame", tabindex: -1 });
  // Embedded, the player fills its container, and the host names it.
  if (embed) frame.dataset["embed"] = "";
  const app = h("div", { class: "app" });
  frame.append(app);
  root.append(frame);
  const player = new Player(app, songs, {
    wasmUrl: new URL("engine.wasm", assets),
    workletUrl: new URL("worklet.js", assets),
    keyboard: frame,
    signal,
    actions,
    onState,
  });
  return { run: (command) => player.run(command) };
}
