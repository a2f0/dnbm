// The site's player page mounts the player the way a host does, through the same shell
// (src/shell.ts) and app module, from the assets one directory above this script. It
// plays the songs its URL names (`?song=<url>`, repeated), or every example song.
// `?embed` shows it as a host would, filling the page without the wordmark.

import { mountApp, PLAYER } from "../../../src/shell";

const params = new URLSearchParams(location.search);
const songs = params.getAll("song").map((song) => new URL(song, document.baseURI).href);
const container = document.getElementById("app");
if (container) {
  mountApp(container, {
    ...PLAYER,
    assetsUrl: new URL("../", import.meta.url),
    embed: params.has("embed"),
    songs: songs.length > 0 ? songs : undefined,
  });
}
