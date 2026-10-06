// Starts the player on the songs its URL names (`?song=<url>`, repeated, as
// mountDnbmPlayer passes them), or on the example songs, which the site serves beside
// the sequencer.

import { parseSongText } from "@a2f0/dnbm-synth/song/format";
import type { Song } from "@a2f0/dnbm-synth/song/model";
import { Player } from "./player";

/** An entry of songs/index.json, which scripts/build.ts writes. */
interface SongIndexEntry {
  readonly file: string;
  readonly title: string;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status}).`);
  return response.text();
}

async function songUrls(params: URLSearchParams): Promise<string[]> {
  const named = params.getAll("song");
  if (named.length > 0) return named;
  const index = JSON.parse(await fetchText("../songs/index.json")) as SongIndexEntry[];
  return index.map(({ file }) => `../songs/${file}`);
}

async function loadSongs(params: URLSearchParams): Promise<Song[]> {
  const urls = await songUrls(params);
  return Promise.all(urls.map(async (url) => parseSongText(await fetchText(url))));
}

const params = new URLSearchParams(location.search);
// mountDnbmPlayer asks for embed mode, where the host already names the player.
if (params.has("embed")) document.documentElement.dataset["embed"] = "";

const root = document.getElementById("app");
if (root) {
  loadSongs(params).then(
    (songs) => new Player(root, songs),
    (error: unknown) => {
      const message = document.createElement("p");
      message.className = "failure";
      message.textContent = error instanceof Error ? error.message : String(error);
      root.replaceChildren(message);
    },
  );
}
