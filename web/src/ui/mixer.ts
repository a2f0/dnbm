// The mixer: a strip per track, the reverb and delay sends, and the master.

import type { App } from "../app";
import {
  DELAY_PARAMS,
  MASTER_PARAMS,
  MIXER_PARAMS,
  type ParamSpec,
  REVERB_PARAMS,
} from "../song/instruments";
import type { Mixer, Song } from "../song/model";
import type { View } from "../view";
import { ParamControl } from "./control";
import { h, setClass } from "./dom";

const SHORT_LABELS: Readonly<Record<string, string>> = {
  pan: "pan",
  lowcut: "lo cut",
  highcut: "hi cut",
  drive: "drive",
  reverb: "verb",
  delay: "delay",
};

/** The meter's floor, in dBFS. */
const METER_FLOOR = -48;
/** How much of the last reading a meter keeps each update: its fall speed. */
const METER_FALL = 0.8;
/** Index of the master's left meter in the engine's meter array. */
const MASTER_METER = 16;

function spec(specs: readonly ParamSpec[], key: string): ParamSpec {
  const found = specs.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`No parameter ${key}`);
  return found;
}

class Meter {
  readonly element: HTMLElement;
  private readonly fill: HTMLElement;
  private level = 0;

  constructor() {
    this.fill = h("div", { class: "meter-fill" });
    this.element = h("div", { class: "meter", "aria-hidden": "true" }, [this.fill]);
  }

  show(peak: number): void {
    this.level = Math.max(peak, this.level * METER_FALL);
    const db = 20 * Math.log10(this.level || 1e-9);
    const height = Math.min(1, Math.max(0, (db - METER_FLOOR) / -METER_FLOOR));
    this.fill.style.height = `${(height * 100).toFixed(1)}%`;
    this.element.classList.toggle("hot", this.level >= 0.98);
  }
}

interface Strip {
  readonly element: HTMLElement;
  readonly name: HTMLButtonElement;
  readonly mute: HTMLButtonElement;
  readonly solo: HTMLButtonElement;
  readonly controls: Map<string, ParamControl>;
  readonly meter: Meter;
}

type NumericMixerKey = Exclude<keyof Mixer, "mute" | "solo">;

export class MixerPanel {
  readonly element: HTMLElement;
  private readonly strips: HTMLElement;
  private tracks: Strip[] = [];
  private key = "";
  private readonly fx = new Map<string, ParamControl>();
  private readonly master = new Map<string, ParamControl>();
  private readonly masterMeters = [new Meter(), new Meter()];
  private peak = 0;
  private readonly peakReadout = h("button", {
    class: "master-peak",
    text: "−∞ dBFS",
    title: "Reset master peak",
    "aria-label": "Reset master peak",
  });

  constructor(private readonly app: App) {
    this.peakReadout.addEventListener("click", () => this.resetPeak());
    this.strips = h("div", { class: "strips" });
    this.element = h("section", { class: "mixer", "aria-label": "Mixer" }, [
      this.strips,
      this.fxStrip(),
      this.masterStrip(),
    ]);
  }

  private control(
    specs: readonly ParamSpec[],
    key: string,
    apply: (song: Song, value: number) => void,
    options: { label?: string; variant?: "knob" | "fader"; gesture: string },
  ): ParamControl {
    return new ParamControl({
      spec: spec(specs, key),
      ...(options.label ? { label: options.label } : {}),
      variant: options.variant ?? "knob",
      onChange: (value) => this.app.edit((song) => apply(song, value), options.gesture),
      onCommit: () => this.app.endGesture(),
    });
  }

  private fxStrip(): HTMLElement {
    for (const param of REVERB_PARAMS) {
      this.fx.set(
        `reverb.${param.key}`,
        this.control(
          REVERB_PARAMS,
          param.key,
          (song, value) => {
            song.reverb[param.key as keyof Song["reverb"]] = value;
          },
          { gesture: `reverb-${param.key}` },
        ),
      );
    }
    for (const param of DELAY_PARAMS) {
      this.fx.set(
        `delay.${param.key}`,
        this.control(
          DELAY_PARAMS,
          param.key,
          (song, value) => {
            song.delay[param.key as keyof Song["delay"]] = value;
          },
          { gesture: `delay-${param.key}` },
        ),
      );
    }
    const group = (title: string, prefix: string) =>
      h("div", { class: "fx-group" }, [
        h("span", { class: "strip-title", text: title }),
        ...[...this.fx]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, control]) => control.element),
      ]);
    return h("div", { class: "strip fx" }, [group("reverb", "reverb."), group("delay", "delay.")]);
  }

  private masterStrip(): HTMLElement {
    const set = (key: string) => (song: Song, value: number) => {
      song.master[key as keyof Song["master"]] = value;
    };
    this.master.set(
      "glue",
      this.control(MASTER_PARAMS, "glue", set("glue"), { gesture: "master-glue" }),
    );
    this.master.set(
      "drive",
      this.control(MASTER_PARAMS, "drive", set("drive"), { gesture: "master-drive" }),
    );
    this.master.set(
      "level",
      this.control(MASTER_PARAMS, "level", set("level"), {
        variant: "fader",
        label: "Master level",
        gesture: "master-level",
      }),
    );
    return h("div", { class: "strip master" }, [
      h("span", { class: "strip-title", text: "master" }),
      h("div", { class: "strip-knobs" }, [
        this.master.get("glue")?.element ?? "",
        this.master.get("drive")?.element ?? "",
      ]),
      h("div", { class: "strip-fader" }, [
        this.masterMeters[0]?.element ?? "",
        this.masterMeters[1]?.element ?? "",
        this.master.get("level")?.element ?? "",
      ]),
      this.peakReadout,
    ]);
  }

  private trackStrip(id: string): Strip {
    const setMixer = (key: NumericMixerKey) => (song: Song, value: number) => {
      const track = song.tracks.find((candidate) => candidate.id === id);
      if (track) track.mixer[key] = value;
    };
    const controls = new Map<string, ParamControl>();
    for (const param of MIXER_PARAMS) {
      const key = param.key as NumericMixerKey;
      controls.set(
        key,
        this.control(MIXER_PARAMS, key, setMixer(key), {
          gesture: `mixer-${id}-${key}`,
          ...(key === "level"
            ? { variant: "fader" as const, label: `${id} level` }
            : { label: SHORT_LABELS[key] ?? key }),
        }),
      );
    }
    const name = h("button", { class: "strip-name", text: id, title: "Select track" });
    name.addEventListener("click", () => this.app.setView({ trackId: id }));
    const toggle = (text: string, key: "mute" | "solo") => {
      const button = h("button", {
        class: "mini",
        text,
        title: `${key === "mute" ? "Mute" : "Solo"} ${id}`,
        "aria-label": `${key === "mute" ? "Mute" : "Solo"} ${id}`,
      });
      button.addEventListener("click", () =>
        this.app.edit((song) => {
          const track = song.tracks.find((candidate) => candidate.id === id);
          if (track) track.mixer[key] = !track.mixer[key];
        }),
      );
      return button;
    };
    const mute = toggle("M", "mute");
    const solo = toggle("S", "solo");
    const meter = new Meter();
    const knobs = [...controls]
      .filter(([key]) => key !== "level")
      .map(([, control]) => control.element);
    const element = h("div", { class: "strip" }, [
      name,
      h("div", { class: "strip-knobs" }, knobs),
      h("div", { class: "strip-fader" }, [meter.element, controls.get("level")?.element ?? ""]),
      h("div", { class: "strip-buttons" }, [mute, solo]),
    ]);
    return { element, name, mute, solo, controls, meter };
  }

  update(song: Song, view: View): void {
    const key = song.tracks.map((track) => track.id).join(",");
    if (key !== this.key) {
      this.key = key;
      this.tracks = song.tracks.map((track) => this.trackStrip(track.id));
      this.strips.replaceChildren(...this.tracks.map((strip) => strip.element));
    }
    const anySolo = song.tracks.some((track) => track.mixer.solo);
    song.tracks.forEach((track, index) => {
      const strip = this.tracks[index];
      if (!strip) return;
      setClass(strip.element, `strip${track.id === view.trackId ? " selected" : ""}`);
      strip.element.classList.toggle(
        "inaudible",
        track.mixer.mute || (anySolo && !track.mixer.solo),
      );
      strip.mute.setAttribute("aria-pressed", String(track.mixer.mute));
      strip.solo.setAttribute("aria-pressed", String(track.mixer.solo));
      for (const [param, control] of strip.controls)
        control.set(track.mixer[param as NumericMixerKey]);
    });
    for (const [key, control] of this.fx) {
      const [group, param] = key.split(".") as ["reverb" | "delay", string];
      const values: Record<string, number> = song[group];
      control.set(values[param] ?? 0);
    }
    for (const [key, control] of this.master) control.set(song.master[key as keyof Song["master"]]);
  }

  /** Shows peak levels from the engine: one per track, then the master's left and right. */
  meters(levels: Float32Array): void {
    this.tracks.forEach((strip, index) => {
      strip.meter.show(levels[index] ?? 0);
    });
    this.masterMeters.forEach((meter, index) => {
      meter.show(levels[MASTER_METER + index] ?? 0);
    });
    const peak = Math.max(levels[MASTER_METER] ?? 0, levels[MASTER_METER + 1] ?? 0);
    if (peak > this.peak) {
      this.peak = peak;
      this.peakReadout.textContent = `${(20 * Math.log10(peak)).toFixed(1)} dBFS`;
      this.peakReadout.classList.toggle("hot", peak >= 0.98);
    }
  }

  resetPeak(): void {
    this.peak = 0;
    this.peakReadout.textContent = "−∞ dBFS";
    this.peakReadout.classList.remove("hot");
  }
}
