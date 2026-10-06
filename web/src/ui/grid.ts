// The step grid for the pattern in the editor: a row per track, a cell per step.
//
// Percussive cells: click cycles rest → hit → accent → ghost; Shift-click sets an
// accent, Alt-click a ghost; drag to paint. Melodic cells: click places the track's
// current note; drag right to hold it; click a note to select it. Right-click clears.
// With the grid focused, arrows move the cursor, and keys enter steps (see onKey).

import type { App } from "../app";
import { createTrack, uniqueId } from "../song/defaults";
import { INSTRUMENT_KINDS, INSTRUMENTS, type InstrumentKind } from "../song/instruments";
import { MAX_TRACKS, type Pattern, type Song } from "../song/model";
import {
  DRUM_CYCLE,
  DRUM_REST,
  HIGHEST_NOTE,
  isDrumToken,
  LOWEST_NOTE,
  noteToken,
  parseNote,
  REST,
  STEPS_PER_BAR,
  STEPS_PER_BEAT,
  TIE,
} from "../song/notation";
import type { View } from "../view";
import { h, setClass, setText } from "./dom";

/** Tracker-style note keys: the bottom row is one octave, the top row the next. */
const PIANO_KEYS: Readonly<Record<string, number>> = {
  z: 0,
  s: 1,
  x: 2,
  d: 3,
  c: 4,
  v: 5,
  g: 6,
  b: 7,
  h: 8,
  n: 9,
  j: 10,
  m: 11,
  ",": 12,
  q: 12,
  "2": 13,
  w: 14,
  "3": 15,
  e: 16,
  r: 17,
  "5": 18,
  t: 19,
  "6": 20,
  y: 21,
  "7": 22,
  u: 23,
  i: 24,
};

const ARROWS: Readonly<Record<string, readonly [tracks: number, steps: number]>> = {
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
};

const TOKEN_NAMES: Readonly<Record<string, string>> = {
  ".": "rest",
  o: "ghost",
  x: "hit",
  X: "accent",
  [REST]: "rest",
  [TIE]: "hold",
};

interface Row {
  readonly head: HTMLElement;
  readonly name: HTMLButtonElement;
  readonly mute: HTMLButtonElement;
  readonly solo: HTMLButtonElement;
  readonly cells: HTMLElement[];
}

interface Paint {
  readonly track: number;
  readonly token: string;
  readonly melodic: boolean;
  readonly origin: number;
  last: number;
  readonly gesture: string;
}

let gestures = 0;

export class Grid {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly ruler: HTMLElement;
  private rows: Row[] = [];
  private structure = "";
  private paint: Paint | undefined;
  private now: number | undefined;

  constructor(private readonly app: App) {
    this.ruler = h("div", { class: "ruler", "aria-hidden": "true" });
    this.body = h("div", {
      class: "grid",
      role: "grid",
      tabindex: 0,
      "aria-label": "Steps. Arrows move; keys enter steps.",
    });
    const add = h("select", { "aria-label": "Add a track" }, [
      h("option", { value: "", text: "+ track" }),
      ...INSTRUMENT_KINDS.map((kind) =>
        h("option", { value: kind, text: INSTRUMENTS[kind].label.toLowerCase() }),
      ),
    ]);
    add.addEventListener("change", () => {
      const kind = add.value as InstrumentKind | "";
      add.value = "";
      if (kind) this.addTrack(kind);
    });
    this.element = h("section", { class: "grid-panel" }, [
      h("div", { class: "grid-scroll" }, [this.ruler, this.body]),
      h("div", { class: "grid-footer" }, [add]),
    ]);
    this.listen();
  }

  private pattern(): Pattern {
    return this.app.pattern();
  }

  private build(song: Song, pattern: Pattern): void {
    const steps = pattern.bars * STEPS_PER_BAR;
    this.element.style.setProperty("--steps", String(steps));
    this.ruler.replaceChildren(
      h("div", { class: "ruler-head" }),
      ...Array.from({ length: steps }, (_, step) =>
        h("div", {
          class: `ruler-step${step % STEPS_PER_BEAT === 0 ? " beat" : ""}${step % STEPS_PER_BAR === 0 ? " bar" : ""}`,
          text: step % STEPS_PER_BEAT === 0 ? String(((step / STEPS_PER_BEAT) % 4) + 1) : "",
        }),
      ),
    );
    this.rows = song.tracks.map((track) => {
      const name = h("button", {
        class: "track-name",
        "data-action": "select",
        text: track.id,
        title: "Select; hold to audition",
      });
      const mute = h("button", { class: "mini", "data-action": "mute", text: "M", title: "Mute" });
      const solo = h("button", { class: "mini", "data-action": "solo", text: "S", title: "Solo" });
      const head = h("div", { class: "track-head", role: "rowheader" }, [
        name,
        h("span", { class: "track-kind", text: track.instrument }),
        mute,
        solo,
      ]);
      const cells = Array.from({ length: steps }, (_, step) =>
        h("div", { class: "cell", role: "gridcell", "data-step": step }),
      );
      return { head, name, mute, solo, cells };
    });
    this.body.replaceChildren(
      ...this.rows.map((row, index) =>
        h("div", { class: "grid-row", role: "row", "data-track": index }, [
          row.head,
          h("div", { class: "cells" }, row.cells),
        ]),
      ),
    );
  }

  update(song: Song, view: View): void {
    const pattern = this.pattern();
    const structure = `${pattern.id}/${pattern.bars}/${song.tracks.map((t) => `${t.id}:${t.instrument}`).join(",")}`;
    if (structure !== this.structure) {
      this.structure = structure;
      this.build(song, pattern);
    }
    song.tracks.forEach((track, index) => {
      const row = this.rows[index];
      if (!row) return;
      setClass(row.head, `track-head${track.id === view.trackId ? " selected" : ""}`);
      row.mute.setAttribute("aria-pressed", String(track.mixer.mute));
      row.solo.setAttribute("aria-pressed", String(track.mixer.solo));
      const tokens = pattern.rows[track.id] ?? [];
      row.cells.forEach((cell, step) => {
        this.paintCell(cell, track.id, tokens[step] ?? ".", index, step);
      });
    });
  }

  private paintCell(
    cell: HTMLElement,
    trackId: string,
    token: string,
    track: number,
    step: number,
  ): void {
    const { cursor } = this.app.view;
    let kind: string;
    let text = "";
    if (isDrumToken(token)) {
      kind = TOKEN_NAMES[token] ?? "rest";
    } else if (token === REST) {
      kind = "rest";
    } else if (token === TIE) {
      kind = "hold";
    } else {
      kind = "note";
      text = token.replace("-", "");
    }
    const position =
      step % STEPS_PER_BAR === 0 ? " bar" : step % STEPS_PER_BEAT === 0 ? " beat" : "";
    const selected = cursor?.track === track && cursor.step === step ? " cursor" : "";
    setClass(cell, `cell ${kind}${position}${selected}${this.now === step ? " now" : ""}`);
    setText(cell, text);
    cell.setAttribute(
      "aria-label",
      `${trackId} step ${step + 1}: ${kind === "note" ? text : kind}`,
    );
  }

  /** Marks the playing step, or none. */
  playhead(step: number | undefined): void {
    if (step === this.now) return;
    const previous = this.now;
    this.now = step;
    for (const row of this.rows) {
      for (const index of [previous, step]) {
        if (index === undefined) continue;
        row.cells[index]?.classList.toggle("now", index === step);
      }
    }
    for (const index of [previous, step]) {
      if (index === undefined) continue;
      this.ruler.children[index + 1]?.classList.toggle("now", index === step);
    }
  }

  private token(track: number, step: number): string {
    const trackId = this.app.song.tracks[track]?.id ?? "";
    return this.pattern().rows[trackId]?.[step] ?? ".";
  }

  private melodic(track: number): boolean {
    const kind = this.app.song.tracks[track]?.instrument;
    return kind !== undefined && INSTRUMENTS[kind].melodic;
  }

  private penNote(track: number): number {
    const t = this.app.song.tracks[track];
    if (!t) return 48;
    return this.app.view.penNotes.get(t.id) ?? INSTRUMENTS[t.instrument].defaultNote;
  }

  private setPen(track: number, note: number): void {
    const id = this.app.song.tracks[track]?.id;
    if (id) this.app.view.penNotes.set(id, note);
  }

  /** Sets steps in one row of the current pattern. */
  private write(track: number, steps: readonly number[], token: string, gesture?: string): void {
    const trackId = this.app.song.tracks[track]?.id;
    const patternId = this.pattern().id;
    if (!trackId) return;
    this.app.edit((song) => {
      const row = song.patterns.find((pattern) => pattern.id === patternId)?.rows[trackId];
      if (!row) return;
      for (const step of steps) if (step >= 0 && step < row.length) row[step] = token;
    }, gesture);
  }

  private cellAt(x: number, y: number): { track: number; step: number } | undefined {
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>(".cell");
    const row = cell?.closest<HTMLElement>(".grid-row");
    if (!cell || !row) return undefined;
    return { track: Number(row.dataset["track"]), step: Number(cell.dataset["step"]) };
  }

  private startPaint(event: PointerEvent, track: number, step: number): void {
    const melodic = this.melodic(track);
    const current = this.token(track, step);
    const gesture = `paint-${++gestures}`;
    this.app.setView({
      cursor: { track, step },
      trackId: this.app.song.tracks[track]?.id ?? this.app.view.trackId,
    });
    if (!melodic) {
      const index = DRUM_CYCLE.indexOf(isDrumToken(current) ? current : ".");
      const token = event.shiftKey
        ? "X"
        : event.altKey
          ? "o"
          : (DRUM_CYCLE[(index + 1) % DRUM_CYCLE.length] ?? ".");
      this.write(track, [step], token, gesture);
      if (token !== DRUM_REST) void this.app.audition(track);
      this.paint = { track, token, melodic, origin: step, last: step, gesture };
      return;
    }
    const note = parseNote(current);
    if (note !== undefined) {
      this.setPen(track, note);
      void this.app.audition(track, note);
    } else if (current === REST || event.shiftKey) {
      const token = event.shiftKey && step > 0 ? TIE : noteToken(this.penNote(track));
      this.write(track, [step], token, gesture);
      if (token !== TIE) void this.app.audition(track);
    }
    this.paint = { track, token: TIE, melodic, origin: step, last: step, gesture };
  }

  private continuePaint(x: number, y: number): void {
    const paint = this.paint;
    const target = paint && this.cellAt(x, y);
    if (!paint || !target || target.track !== paint.track || target.step === paint.last) return;
    if (paint.melodic) {
      // Dragging right holds the note through each step reached.
      if (target.step > paint.last) {
        const steps = Array.from(
          { length: target.step - paint.last },
          (_, i) => paint.last + 1 + i,
        );
        this.write(
          paint.track,
          steps.filter((step) => step > paint.origin),
          TIE,
          paint.gesture,
        );
      }
    } else {
      this.write(paint.track, [target.step], paint.token, paint.gesture);
    }
    paint.last = target.step;
  }

  private endPaint(): void {
    if (!this.paint) return;
    this.paint = undefined;
    this.app.endGesture();
  }

  private headAction(action: string, track: number): void {
    const t = this.app.song.tracks[track];
    if (!t) return;
    if (action === "select") {
      this.app.setView({ trackId: t.id });
      void this.app.audition(track);
    } else if (action === "mute" || action === "solo") {
      this.app.edit((song) => {
        const target = song.tracks[track];
        if (target) target.mixer[action] = !target.mixer[action];
      });
    }
  }

  private listen(): void {
    this.body.addEventListener("pointerdown", (event) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>(".grid-row");
      if (!row || event.button !== 0) return;
      const track = Number(row.dataset["track"]);
      const action = target.closest<HTMLElement>("[data-action]")?.dataset["action"];
      if (action) {
        this.headAction(action, track);
        return;
      }
      const cell = target.closest<HTMLElement>(".cell");
      if (!cell) return;
      event.preventDefault();
      this.body.focus({ preventScroll: true });
      this.body.setPointerCapture(event.pointerId);
      this.startPaint(event, track, Number(cell.dataset["step"]));
    });
    this.body.addEventListener("pointermove", (event) =>
      this.continuePaint(event.clientX, event.clientY),
    );
    this.body.addEventListener("pointerup", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(".grid-row");
      if (row && (event.target as HTMLElement).closest("[data-action='select']")) {
        this.app.release(Number(row.dataset["track"]));
      }
      if (this.paint) this.app.release(this.paint.track);
      this.endPaint();
    });
    this.body.addEventListener("pointercancel", () => this.endPaint());
    this.body.addEventListener("contextmenu", (event) => {
      const cell = (event.target as HTMLElement).closest<HTMLElement>(".cell");
      const row = cell?.closest<HTMLElement>(".grid-row");
      if (!cell || !row) return;
      event.preventDefault();
      const track = Number(row.dataset["track"]);
      this.write(track, [Number(cell.dataset["step"])], this.melodic(track) ? REST : DRUM_REST);
    });
    this.body.addEventListener("keydown", (event) => this.onKey(event));
  }

  private move(track: number, step: number): void {
    const tracks = this.app.song.tracks.length;
    const steps = this.pattern().bars * STEPS_PER_BAR;
    if (tracks === 0) return;
    const next = { track: (track + tracks) % tracks, step: (step + steps) % steps };
    this.app.setView({
      cursor: next,
      trackId: this.app.song.tracks[next.track]?.id ?? this.app.view.trackId,
    });
    this.rows[next.track]?.cells[next.step]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }

  /**
   * Arrows move the cursor. Percussive steps: x hit, X accent, o ghost, Enter cycles.
   * Melodic steps: z s x d c v g b h n j m (and q 2 w 3 e r ... above) enter notes,
   * - holds, [ and ] change octave, Shift+Up/Down transposes a semitone and
   * Alt+Up/Down an octave. Backspace, Delete or . clears.
   */
  private onKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey) return;
    const { track, step } = this.app.view.cursor ?? { track: 0, step: 0 };
    const handled = this.melodic(track)
      ? this.noteKey(event, track, step)
      : this.drumKey(event, track, step);
    if (handled || this.commonKey(event, track, step)) event.preventDefault();
  }

  /** Moving, clearing and deselecting, on any track. */
  private commonKey(event: KeyboardEvent, track: number, step: number): boolean {
    const arrow = ARROWS[event.key];
    if (arrow) {
      this.move(track + arrow[0], step + arrow[1]);
    } else if (event.key === "Backspace" || event.key === "Delete" || event.key === ".") {
      this.write(track, [step], this.melodic(track) ? REST : DRUM_REST);
    } else if (event.key === "Escape") {
      this.app.setView({ cursor: undefined });
    } else {
      return false;
    }
    return true;
  }

  private drumKey(event: KeyboardEvent, track: number, step: number): boolean {
    if (!["x", "X", "o", "Enter"].includes(event.key)) return false;
    const current = this.token(track, step);
    const index = DRUM_CYCLE.indexOf(isDrumToken(current) ? current : ".");
    const token =
      event.key === "Enter" ? (DRUM_CYCLE[(index + 1) % DRUM_CYCLE.length] ?? ".") : event.key;
    this.write(track, [step], token);
    if (token !== DRUM_REST) void this.app.audition(track);
    if (event.key !== "Enter") this.move(track, step + 1);
    return true;
  }

  private enterNote(track: number, step: number, note: number): void {
    const next = Math.min(HIGHEST_NOTE, Math.max(LOWEST_NOTE, note));
    this.write(track, [step], noteToken(next));
    this.setPen(track, next);
    void this.app.audition(track, next);
    setTimeout(() => this.app.release(track), 180);
  }

  private noteKey(event: KeyboardEvent, track: number, step: number): boolean {
    const arrow = ARROWS[event.key];
    const note = parseNote(this.token(track, step));
    if (arrow && arrow[0] !== 0 && note !== undefined && (event.shiftKey || event.altKey)) {
      this.enterNote(track, step, note - arrow[0] * (event.altKey ? 12 : 1));
    } else if (event.key === "[" || event.key === "]") {
      const pen = this.penNote(track) + (event.key === "]" ? 12 : -12);
      this.setPen(track, Math.min(HIGHEST_NOTE, Math.max(LOWEST_NOTE, pen)));
      const octave = Math.floor(this.penNote(track) / 12) - 1;
      this.app.say(`${this.app.song.tracks[track]?.id} enters notes from octave ${octave}.`);
    } else if (event.key === "-" || event.key === "Enter") {
      this.write(track, [step], event.key === "-" ? TIE : noteToken(this.penNote(track)));
      this.move(track, step + 1);
    } else if (event.key in PIANO_KEYS && !event.altKey) {
      const octave = Math.floor(this.penNote(track) / 12) * 12;
      this.enterNote(track, step, octave + (PIANO_KEYS[event.key] ?? 0));
      this.move(track, step + 1);
    } else {
      return false;
    }
    return true;
  }

  private addTrack(kind: InstrumentKind): void {
    const { song } = this.app;
    if (song.tracks.length >= MAX_TRACKS) {
      this.app.say(`A song holds at most ${MAX_TRACKS} tracks.`, true);
      return;
    }
    const id = uniqueId(
      kind,
      song.tracks.map((track) => track.id),
    );
    this.app.edit((draft) => {
      draft.tracks.push(createTrack(id, kind));
    });
    this.app.setView({ trackId: id });
  }
}
