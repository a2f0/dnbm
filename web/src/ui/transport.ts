// The top bar: song title, transport, tempo, position, scope, and file actions.

import type { App } from "../app";
import type { PlayingPosition } from "../audio/engineHost";
import { BPM, quantize, SWING } from "../song/instruments";
import type { Song } from "../song/model";
import type { SongStore } from "../store";
import type { View } from "../view";
import { ParamControl } from "./control";
import { h, setText, svg } from "./dom";
import type { Scope } from "./scope";

function icon(path: string): SVGSVGElement {
  return svg("svg", { viewBox: "0 0 24 24", class: "icon", "aria-hidden": "true" }, [
    svg("path", { d: path }),
  ]);
}

const PLAY = "M7 4.5v15l12-7.5z";
const STOP = "M6 6h12v12H6z";

/** "slot/slots pattern bar.beat.sixteenth" for a playing step. */
export function describePosition(song: Song, position: PlayingPosition): string {
  const pattern = song.patterns[position.pattern]?.id ?? "?";
  const bar = Math.floor(position.step / 16) + 1;
  const beat = Math.floor((position.step % 16) / 4) + 1;
  const sixteenth = (position.step % 4) + 1;
  const slot = `${String(position.slot + 1).padStart(2, "0")}/${String(song.arrangement.length).padStart(2, "0")}`;
  return `${slot} ${pattern} ${bar}.${beat}.${sixteenth}`;
}

export class Transport {
  readonly element: HTMLElement;
  private readonly title: HTMLInputElement;
  private readonly playButton: HTMLButtonElement;
  private readonly modes: Record<View["mode"], HTMLButtonElement>;
  private readonly bpm: HTMLInputElement;
  private readonly swing: ParamControl;
  private readonly readout: HTMLOutputElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly examples: HTMLSelectElement;

  constructor(app: App, scope: Scope) {
    this.title = h("input", {
      class: "title",
      "aria-label": "Song title",
      maxlength: 120,
      spellcheck: false,
    });
    this.title.addEventListener("change", () => {
      const title = this.title.value.trim() || "Untitled";
      app.edit((song) => {
        song.title = title;
      });
    });

    this.playButton = h("button", {
      class: "play",
      "aria-label": "Play",
      title: "Play / stop (space)",
    });
    this.playButton.addEventListener("click", () => app.togglePlay());

    this.modes = {
      song: h("button", { text: "song", title: "Play the arrangement" }),
      loop: h("button", { text: "loop", title: "Loop the pattern in the editor" }),
    };
    for (const mode of ["song", "loop"] as const) {
      this.modes[mode].addEventListener("click", () => app.setMode(mode));
    }

    this.bpm = h("input", {
      class: "bpm",
      type: "number",
      min: BPM.min,
      max: BPM.max,
      step: BPM.step,
      "aria-label": "Tempo in BPM",
    });
    this.bpm.addEventListener("change", () => {
      const value = Number(this.bpm.value);
      if (!Number.isFinite(value)) return;
      app.edit((song) => {
        song.bpm = quantize(BPM, value);
      });
    });

    this.swing = new ParamControl({
      spec: SWING,
      onChange: (value) =>
        app.edit((song) => {
          song.swing = value;
        }, "swing"),
      onCommit: () => app.endGesture(),
    });

    this.readout = h("output", {
      class: "position",
      "aria-label": "Position",
      text: "--/-- - 1.1.1",
    });

    const button = (text: string, title: string, action: () => void) => {
      const element = h("button", { text, title });
      element.addEventListener("click", action);
      return element;
    };
    this.undoButton = button("undo", "Undo (⌘Z)", () => app.store.undo());
    this.redoButton = button("redo", "Redo (⇧⌘Z)", () => app.store.redo());

    this.examples = h("select", { "aria-label": "Open an example song" }, [
      h("option", { value: "", text: "examples" }),
    ]);
    this.examples.addEventListener("change", () => {
      const file = this.examples.value;
      this.examples.value = "";
      if (file) void app.openExample(file);
    });
    void this.loadExamples();

    this.element = h("header", { class: "topbar" }, [
      h("div", { class: "brand", text: "dnbm" }),
      this.title,
      h("div", { class: "transport" }, [
        this.playButton,
        h("div", { class: "segmented", role: "group", "aria-label": "Play mode" }, [
          this.modes.song,
          this.modes.loop,
        ]),
        h("label", { class: "bpm-field" }, [this.bpm, h("span", { text: "bpm" })]),
        this.swing.element,
        this.readout,
      ]),
      scope.element,
      h("nav", { class: "files", "aria-label": "Song" }, [
        button("new", "New song", () => app.newSong()),
        button("open", "Open a song file (⌘O)", () => void app.open()),
        button(
          "save",
          "Save (⌘S); ⇧ to save as",
          (event?: unknown) => void app.save(event instanceof MouseEvent && event.shiftKey),
        ),
        button("export", "Render the song to a WAV file", () => void app.exportWav()),
        this.examples,
        this.undoButton,
        this.redoButton,
      ]),
    ]);
  }

  private async loadExamples(): Promise<void> {
    try {
      const response = await fetch("songs/index.json");
      if (!response.ok) return;
      const songs: { file: string; title: string }[] = await response.json();
      for (const song of songs)
        this.examples.append(h("option", { value: song.file, text: song.title }));
    } catch {
      // Examples are optional, as when the page is opened without the server.
    }
  }

  update(song: Song, view: View, store: SongStore): void {
    if (document.activeElement !== this.title) this.title.value = song.title;
    if (document.activeElement !== this.bpm) this.bpm.value = String(song.bpm);
    this.swing.set(song.swing);
    this.playButton.replaceChildren(icon(view.playing ? STOP : PLAY));
    this.playButton.setAttribute("aria-label", view.playing ? "Stop" : "Play");
    this.playButton.classList.toggle("active", view.playing);
    for (const mode of ["song", "loop"] as const) {
      this.modes[mode].setAttribute("aria-pressed", String(view.mode === mode));
    }
    this.undoButton.disabled = !store.canUndo;
    this.redoButton.disabled = !store.canRedo;
    if (!view.playing) {
      const slot = view.mode === "song" ? view.startSlot : 0;
      const pattern = view.mode === "song" ? (song.arrangement[slot] ?? "") : view.patternId;
      setText(
        this.readout,
        `${String(slot + 1).padStart(2, "0")}/${String(song.arrangement.length).padStart(2, "0")} ${pattern} 1.1.1`,
      );
    }
  }

  position(song: Song, position: PlayingPosition): void {
    setText(this.readout, describePosition(song, position));
  }
}
