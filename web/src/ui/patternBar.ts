// Pattern tabs and actions, and the arrangement: the order patterns play in.

import type { App } from "../app";
import { createPattern, nextPatternId } from "../song/defaults";
import { INSTRUMENTS } from "../song/instruments";
import { ID_PATTERN, MAX_PATTERNS, type Song } from "../song/model";
import { DRUM_REST, emptyRow, MAX_BARS, REST, STEPS_PER_BAR } from "../song/notation";
import type { View } from "../view";
import { h, setClass } from "./dom";

export class PatternBar {
  readonly element: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly bars: HTMLButtonElement[];
  private readonly chips: HTMLElement;
  private readonly arrangementInput: HTMLInputElement;
  private chipKey = "";
  private playingSlot: number | undefined;

  constructor(private readonly app: App) {
    this.tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Patterns" });
    this.tabs.addEventListener("click", (event) => {
      const tab = (event.target as HTMLElement).closest<HTMLElement>("[data-pattern]");
      if (tab?.dataset["pattern"]) app.selectPattern(tab.dataset["pattern"]);
    });
    this.tabs.addEventListener("dblclick", () => this.rename());

    const action = (text: string, title: string, run: () => void) => {
      const button = h("button", { text, title });
      button.addEventListener("click", run);
      return button;
    };

    this.bars = Array.from({ length: MAX_BARS }, (_, index) => {
      const button = h("button", {
        text: String(index + 1),
        title: `${index + 1} bar${index ? "s" : ""}`,
      });
      button.addEventListener("click", () => this.setBars(index + 1));
      return button;
    });

    this.chips = h("div", { class: "chips", "aria-label": "Arrangement" });
    this.chips.addEventListener("click", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-slot]");
      if (chip) app.playFrom(Number(chip.dataset["slot"]));
    });
    this.chips.addEventListener("contextmenu", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-slot]");
      if (!chip) return;
      event.preventDefault();
      this.removeSlot(Number(chip.dataset["slot"]));
    });

    this.arrangementInput = h("input", {
      class: "arrangement-input",
      "aria-label": "Arrangement, as pattern ids separated by spaces",
      spellcheck: false,
      hidden: true,
    });
    this.arrangementInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.applyArrangement();
      if (event.key === "Escape") this.arrangementInput.hidden = true;
    });
    this.arrangementInput.addEventListener("blur", () => {
      this.arrangementInput.hidden = true;
    });

    this.element = h("section", { class: "patterns" }, [
      h("div", { class: "pattern-row" }, [
        h("span", { class: "section-label", text: "patterns" }),
        this.tabs,
        h("div", { class: "pattern-actions" }, [
          action("+", "New pattern", () => this.add()),
          action("dup", "Duplicate this pattern", () => this.duplicate()),
          action("rename", "Rename this pattern (or double-click its tab)", () => this.rename()),
          action("del", "Delete this pattern", () => this.remove()),
          h("div", { class: "segmented", role: "group", "aria-label": "Bars" }, this.bars),
        ]),
      ]),
      h("div", { class: "pattern-row" }, [
        h("span", { class: "section-label", text: "song" }),
        this.chips,
        this.arrangementInput,
        h("div", { class: "pattern-actions" }, [
          action("+ add", "Add this pattern to the end of the song", () => this.append()),
          action("edit", "Edit the arrangement as text", () => this.editArrangement()),
        ]),
      ]),
    ]);
  }

  update(song: Song, view: View): void {
    this.tabs.replaceChildren(
      ...song.patterns.map((pattern) =>
        h("button", {
          role: "tab",
          class: "tab",
          "data-pattern": pattern.id,
          "aria-selected": String(pattern.id === view.patternId),
          text: pattern.id,
        }),
      ),
    );
    const pattern = this.app.pattern();
    this.bars.forEach((button, index) => {
      button.setAttribute("aria-pressed", String(pattern.bars === index + 1));
    });
    const key = `${song.arrangement.join(" ")}|${view.startSlot}|${view.mode}`;
    if (key !== this.chipKey) {
      this.chipKey = key;
      this.chips.replaceChildren(
        ...song.arrangement.map((id, slot) =>
          h("button", {
            class: "chip",
            "data-slot": slot,
            text: id,
            title: `Slot ${slot + 1}: click to play from here, right-click to remove`,
          }),
        ),
      );
      this.paintChips();
    }
  }

  playing(slot: number | undefined): void {
    if (slot === this.playingSlot) return;
    this.playingSlot = slot;
    this.paintChips();
  }

  private paintChips(): void {
    const { view } = this.app;
    this.chips.querySelectorAll<HTMLElement>(".chip").forEach((chip, slot) => {
      const now = slot === this.playingSlot;
      setClass(
        chip,
        `chip${now ? " now" : ""}${!view.playing && view.mode === "song" && slot === view.startSlot ? " start" : ""}`,
      );
      if (now) chip.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  private add(): void {
    const { song } = this.app;
    if (song.patterns.length >= MAX_PATTERNS) return;
    const id = nextPatternId(song.patterns.map((pattern) => pattern.id));
    this.app.edit((draft) => {
      draft.patterns.push(createPattern(id, 2, draft.tracks));
    });
    this.app.selectPattern(id);
  }

  private duplicate(): void {
    const { song } = this.app;
    if (song.patterns.length >= MAX_PATTERNS) return;
    const source = this.app.pattern();
    const id = nextPatternId(song.patterns.map((pattern) => pattern.id));
    this.app.edit((draft) => {
      const index = draft.patterns.findIndex((pattern) => pattern.id === source.id);
      draft.patterns.splice(index + 1, 0, { ...structuredClone(source), id });
    });
    this.app.selectPattern(id);
  }

  private rename(): void {
    const old = this.app.pattern().id;
    const id = prompt("Pattern id (lowercase letters, digits, hyphens):", old)?.trim();
    if (!id || id === old) return;
    if (!ID_PATTERN.test(id) || this.app.song.patterns.some((pattern) => pattern.id === id)) {
      this.app.say(`"${id}" isn't a free pattern id.`, true);
      return;
    }
    this.app.edit((draft) => {
      for (const pattern of draft.patterns) if (pattern.id === old) pattern.id = id;
      draft.arrangement = draft.arrangement.map((slot) => (slot === old ? id : slot));
    });
    this.app.selectPattern(id);
  }

  private remove(): void {
    const { song } = this.app;
    const id = this.app.pattern().id;
    if (song.patterns.length === 1) {
      this.app.say("A song needs at least one pattern.", true);
      return;
    }
    if (!confirm(`Delete pattern "${id}" and its slots in the song?`)) return;
    this.app.edit((draft) => {
      draft.patterns = draft.patterns.filter((pattern) => pattern.id !== id);
      draft.arrangement = draft.arrangement.filter((slot) => slot !== id);
      if (draft.arrangement.length === 0) draft.arrangement = [draft.patterns[0]?.id ?? ""];
    });
  }

  /** Changes the length; growing repeats the bars already there. */
  private setBars(bars: number): void {
    const id = this.app.pattern().id;
    this.app.edit((draft) => {
      const pattern = draft.patterns.find((candidate) => candidate.id === id);
      if (!pattern) return;
      const steps = bars * STEPS_PER_BAR;
      for (const track of draft.tracks) {
        const melodic = INSTRUMENTS[track.instrument].melodic;
        const row = pattern.rows[track.id] ?? emptyRow(pattern.bars, melodic);
        pattern.rows[track.id] = Array.from(
          { length: steps },
          (_, step) => row[step % row.length] ?? (melodic ? REST : DRUM_REST),
        );
      }
      pattern.bars = bars;
    });
  }

  private append(): void {
    const id = this.app.pattern().id;
    this.app.edit((draft) => {
      draft.arrangement.push(id);
    });
  }

  private removeSlot(slot: number): void {
    if (this.app.song.arrangement.length === 1) return;
    this.app.edit((draft) => {
      draft.arrangement.splice(slot, 1);
    });
  }

  private editArrangement(): void {
    this.arrangementInput.value = this.app.song.arrangement.join(" ");
    this.arrangementInput.hidden = false;
    this.arrangementInput.focus();
  }

  private applyArrangement(): void {
    const ids = this.arrangementInput.value.split(/\s+/).filter(Boolean);
    const known = new Set(this.app.song.patterns.map((pattern) => pattern.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (ids.length === 0 || unknown.length > 0) {
      this.app.say(
        ids.length === 0
          ? "The song needs at least one slot."
          : `Unknown pattern: ${unknown.join(", ")}`,
        true,
      );
      return;
    }
    this.arrangementInput.hidden = true;
    this.app.edit((draft) => {
      draft.arrangement = ids;
    });
  }
}
