// The selected track: its name, instrument, choke group, position, and sound.

import {
  CHOKE_GROUPS,
  defaults,
  INSTRUMENT_KINDS,
  INSTRUMENTS,
  type InstrumentKind,
} from "@a2f0/dnbm-synth/song/instruments";
import { ID_PATTERN, type Song } from "@a2f0/dnbm-synth/song/model";
import { convertRow } from "@a2f0/dnbm-synth/song/notation";
import type { App } from "../app";
import type { View } from "../view";
import { ParamControl } from "./control";
import { h, setText } from "./dom";

export class DevicePanel {
  readonly element: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly instrument: HTMLSelectElement;
  private readonly choke: HTMLSelectElement;
  private readonly description: HTMLElement;
  private readonly knobs: HTMLElement;
  private controls = new Map<string, ParamControl>();
  private key = "";

  constructor(private readonly app: App) {
    this.name = h("input", {
      class: "device-name",
      "aria-label": "Track name",
      spellcheck: false,
      maxlength: 16,
    });
    this.name.addEventListener("change", () => this.rename());
    this.instrument = h(
      "select",
      { "aria-label": "Instrument" },
      INSTRUMENT_KINDS.map((kind) =>
        h("option", { value: kind, text: INSTRUMENTS[kind].label.toLowerCase() }),
      ),
    );
    this.instrument.addEventListener("change", () =>
      this.setInstrument(this.instrument.value as InstrumentKind),
    );
    this.choke = h(
      "select",
      { "aria-label": "Choke group", title: "Hits in a choke group cut each other off" },
      [
        h("option", { value: "0", text: "no choke" }),
        ...Array.from({ length: CHOKE_GROUPS }, (_, index) =>
          h("option", { value: String(index + 1), text: `choke ${index + 1}` }),
        ),
      ],
    );
    this.choke.addEventListener("change", () => {
      const id = this.app.view.trackId;
      const choke = Number(this.choke.value);
      this.app.edit((song) => {
        const track = song.tracks.find((candidate) => candidate.id === id);
        if (track) track.choke = choke;
      });
    });
    const action = (text: string, title: string, run: () => void) => {
      const button = h("button", { text, title });
      button.addEventListener("click", run);
      return button;
    };
    this.description = h("p", { class: "device-description" });
    this.knobs = h("div", { class: "knobs" });
    this.element = h("section", { class: "device", "aria-label": "Track" }, [
      h("header", { class: "device-header" }, [
        this.name,
        this.instrument,
        this.choke,
        h("div", { class: "device-actions" }, [
          action("↑", "Move track up", () => this.move(-1)),
          action("↓", "Move track down", () => this.move(1)),
          action("del", "Delete track", () => void this.remove()),
        ]),
      ]),
      this.description,
      this.knobs,
    ]);
  }

  update(song: Song, view: View): void {
    const track = song.tracks.find((candidate) => candidate.id === view.trackId);
    this.element.hidden = !track;
    if (!track) return;
    if (!this.name.matches(":focus")) this.name.value = track.id;
    this.instrument.value = track.instrument;
    this.choke.value = String(track.choke);
    const spec = INSTRUMENTS[track.instrument];
    setText(
      this.description,
      spec.melodic
        ? `${spec.description}. Keys: z s x d c v g b h n j m enter notes, - holds, [ ] octave.`
        : `${spec.description}. Keys: x hit, X accent, o ghost.`,
    );
    const key = `${track.id}/${track.instrument}`;
    if (key !== this.key) {
      this.key = key;
      this.controls = new Map(
        spec.params.map((param) => [
          param.key,
          new ParamControl({
            spec: param,
            onChange: (value) =>
              this.app.edit((draft) => {
                const target = draft.tracks.find((candidate) => candidate.id === track.id);
                if (target) target.params[param.key] = value;
              }, `param-${track.id}-${param.key}`),
            onCommit: () => this.app.endGesture(),
          }),
        ]),
      );
      this.knobs.replaceChildren(...[...this.controls.values()].map((control) => control.element));
    }
    for (const [key, control] of this.controls) control.set(track.params[key] ?? 0);
  }

  private rename(): void {
    const old = this.app.view.trackId;
    const id = this.name.value.trim();
    if (id === old) return;
    if (!ID_PATTERN.test(id) || this.app.song.tracks.some((track) => track.id === id)) {
      this.app.say(
        `"${id}" isn't a free track name: use lowercase letters, digits and hyphens.`,
        true,
      );
      this.name.value = old;
      return;
    }
    this.app.edit((song) => {
      const track = song.tracks.find((candidate) => candidate.id === old);
      if (!track) return;
      track.id = id;
      for (const pattern of song.patterns) {
        pattern.rows[id] = pattern.rows[old] ?? [];
        delete pattern.rows[old];
      }
    });
    const pen = this.app.view.penNotes.get(old);
    if (pen !== undefined) this.app.view.penNotes.set(id, pen);
    this.app.setView({ trackId: id });
  }

  /** Switches instrument, rewriting the track's rows if it changes between hits and notes. */
  private setInstrument(kind: InstrumentKind): void {
    const id = this.app.view.trackId;
    this.app.edit((song) => {
      const track = song.tracks.find((candidate) => candidate.id === id);
      if (!track || track.instrument === kind) return;
      const melodic = INSTRUMENTS[kind].melodic;
      if (melodic !== INSTRUMENTS[track.instrument].melodic) {
        for (const pattern of song.patterns) {
          pattern.rows[id] = convertRow(
            pattern.rows[id] ?? [],
            melodic,
            INSTRUMENTS[kind].defaultNote,
          );
        }
      }
      track.instrument = kind;
      track.params = defaults(INSTRUMENTS[kind].params);
    });
  }

  private move(offset: number): void {
    const id = this.app.view.trackId;
    this.app.edit((song) => {
      const index = song.tracks.findIndex((track) => track.id === id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= song.tracks.length) return;
      const [track] = song.tracks.splice(index, 1);
      if (track) song.tracks.splice(target, 0, track);
    });
  }

  private async remove(): Promise<void> {
    const id = this.app.view.trackId;
    if (
      !(await this.app.dialogs.confirm(
        `Delete track "${id}" and its steps in every pattern?`,
        "delete",
      ))
    )
      return;
    this.app.edit((song) => {
      song.tracks = song.tracks.filter((track) => track.id !== id);
      for (const pattern of song.patterns) delete pattern.rows[id];
    });
  }
}
