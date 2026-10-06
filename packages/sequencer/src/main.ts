// Starts the editor with the last session's song, or the example song on a first visit.

import { parseSong, parseSongText } from "@a2f0/dnbm-synth/song/format";
import type { Song } from "@a2f0/dnbm-synth/song/model";
import undertow from "../../../songs/undertow.dnbm.json";
import { App, AUTOSAVE_KEY, readStorage, SAVED_KEY } from "./app";

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

// mountDnbm (src/index.ts at the repository root) asks for embed mode, where the host already names the app.
if (new URLSearchParams(location.search).has("embed")) {
  document.documentElement.dataset["embed"] = "";
}

const root = document.getElementById("app");
if (root) {
  const { song, saved } = initialSong();
  new App(root, song, saved);
}
