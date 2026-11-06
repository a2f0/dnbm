// The sequencer's app module, built to mount.js beside the site's pages: the shell
// (src/shell.ts) imports it from the assets and mounts the editor into a shadow root,
// for a host's `mountDnbm` and for the site's own page alike. It opens the last
// session's song, or the example song on a first visit, and returns the control the
// host's commands go through.

import { parseSong } from "@a2f0/dnbm-synth/song/format";
import undertow from "../../../songs/undertow.dnbm.json";
import type { AppContext, AppControl } from "../../../src/shell";
import { App } from "./app";
import { restoreSong } from "./storage";
import { h } from "./ui/dom";

export function mount(
  root: ShadowRoot,
  { assets, signal, embed, actions, onTitle, onState }: AppContext,
): AppControl {
  // The frame scrolls, sizes the layout's container queries, and takes focus on a press
  // anywhere in the app, so the app's shortcuts see its keys and no others.
  const frame = h("div", { class: "frame", tabindex: -1 });
  // Embedded, the host already names the app.
  if (embed) frame.dataset["embed"] = "";
  const app = h("div", { class: "app" });
  frame.append(app);
  root.append(frame);
  // The last session's song, or the example song on a first visit.
  const { song, saved, problem } = restoreSong(() => parseSong(undertow));
  const editor = new App(app, song, saved, {
    frame,
    root,
    assets,
    signal,
    onTitle,
    actions: actions !== false,
    onState,
  });
  if (problem) editor.say(problem, true);
  return { run: (command) => editor.run(command) };
}
