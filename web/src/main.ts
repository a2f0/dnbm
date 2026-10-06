// Starts the editor with the last session's song, or the example song on a first visit.

import undertow from "../../songs/undertow.dnbm.json";
import { App, AUTOSAVE_KEY, readStorage, SAVED_KEY } from "./app";
import { parseSong, parseSongText } from "./song/format";
import type { Song } from "./song/model";

function initialSong(): { song: Song; saved: string | undefined } {
  const text = readStorage(AUTOSAVE_KEY);
  if (text) {
    try {
      return { song: parseSongText(text), saved: readStorage(SAVED_KEY) ?? undefined };
    } catch {
      // An autosave from an older or broken session: start from the example instead.
    }
  }
  return { song: parseSong(undertow), saved: undefined };
}

const root = document.getElementById("app");
if (root) {
  const { song, saved } = initialSong();
  new App(root, song, saved);
}
