// New songs, tracks and patterns.

import {
  BPM,
  DELAY_PARAMS,
  defaults,
  INSTRUMENTS,
  type InstrumentKind,
  MASTER_PARAMS,
  MIXER_PARAMS,
  REVERB_PARAMS,
  SWING,
} from "./instruments";
import { ID_PATTERN, type Mixer, type Pattern, type Song, type Track } from "./model";
import { emptyRow } from "./notation";

export function defaultMixer(): Mixer {
  const values = defaults(MIXER_PARAMS);
  return {
    level: values["level"] ?? 0,
    pan: values["pan"] ?? 0,
    mute: false,
    solo: false,
    lowcut: values["lowcut"] ?? 20,
    highcut: values["highcut"] ?? 20000,
    drive: values["drive"] ?? 0,
    reverb: values["reverb"] ?? 0,
    delay: values["delay"] ?? 0,
  };
}

export function createTrack(id: string, instrument: InstrumentKind): Track {
  return {
    id,
    instrument,
    choke: 0,
    mixer: defaultMixer(),
    params: defaults(INSTRUMENTS[instrument].params),
  };
}

export function createPattern(id: string, bars: number, tracks: readonly Track[]): Pattern {
  return {
    id,
    bars,
    rows: Object.fromEntries(
      tracks.map((track) => [track.id, emptyRow(bars, INSTRUMENTS[track.instrument].melodic)]),
    ),
  };
}

/** `base` made into a valid id that none of `taken` uses: "kick", then "kick-2", ... */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const cleaned =
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^[^a-z]+/, "")
      .slice(0, 12) || "t";
  if (!used.has(cleaned) && ID_PATTERN.test(cleaned)) return cleaned;
  for (let n = 2; ; n++) {
    const candidate = `${cleaned}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The first free pattern id: "a" to "z", then "p27", "p28", ... */
export function nextPatternId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let code = 97; code <= 122; code++) {
    const letter = String.fromCharCode(code);
    if (!used.has(letter)) return letter;
  }
  return uniqueId("p27", used);
}

/** A blank song with a dark kit, ready to program. */
export function newSong(): Song {
  const tracks = [
    createTrack("kick", "kick"),
    createTrack("snare", "snare"),
    { ...createTrack("hat", "hat"), choke: 1 },
    {
      ...createTrack("open", "hat"),
      choke: 1,
      params: { ...defaults(INSTRUMENTS.hat.params), decay: 0.3 },
    },
    { ...createTrack("sub", "sub"), mixer: { ...defaultMixer(), highcut: 200 } },
    { ...createTrack("reese", "reese"), mixer: { ...defaultMixer(), lowcut: 70, level: -6 } },
    { ...createTrack("pluck", "pluck"), mixer: { ...defaultMixer(), level: -10, reverb: 0.4 } },
  ];
  const master = defaults(MASTER_PARAMS);
  const reverb = defaults(REVERB_PARAMS);
  const delay = defaults(DELAY_PARAMS);
  return {
    title: "Untitled",
    bpm: BPM.default,
    swing: SWING.default,
    master: { level: master["level"] ?? 0, glue: master["glue"] ?? 0, drive: master["drive"] ?? 0 },
    reverb: { size: reverb["size"] ?? 0, damp: reverb["damp"] ?? 0 },
    delay: { time: delay["time"] ?? 3, feedback: delay["feedback"] ?? 0, tone: delay["tone"] ?? 0 },
    tracks,
    patterns: [createPattern("a", 2, tracks)],
    arrangement: ["a"],
  };
}
