// The sequencer's app module, built to mount.js beside the site's pages: the shell
// (src/shell.ts) imports it from the assets and mounts the editor into a shadow root,
// for a host's `mountDnbm` and for the site's own page alike. It opens the last
// session's song, or the example song on a first visit.

import { parseSong, parseSongText } from "@a2f0/dnbm-synth/song/format";
import type { Song } from "@a2f0/dnbm-synth/song/model";
import undertow from "../../../songs/undertow.dnbm.json";
import type { AppContext } from "../../../src/shell";
import { App, AUTOSAVE_KEY, readStorage, SAVED_KEY } from "./app";
import { h } from "./ui/dom";

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

export function mount(root: ShadowRoot, { assets, signal, embed, onTitle }: AppContext): void {
  // The frame scrolls, sizes the layout's container queries, and takes focus on a press
  // anywhere in the app, so the app's shortcuts see its keys and no others.
  const frame = h("div", { class: "frame", tabindex: -1 });
  // Embedded, the host already names the app.
  if (embed) frame.dataset["embed"] = "";
  const app = h("div", { class: "app" });
  frame.append(app);
  root.append(frame);
  const { song, saved } = initialSong();
  new App(app, song, saved, { frame, root, assets, signal, onTitle });
}
