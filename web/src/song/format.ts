// Song files: JSON written so that it diffs well and merges cleanly in Git.
//
// - Keys come in a fixed order, values round to their parameter's step, and nothing
//   volatile (timestamps, random ids) is stored, so saving an unchanged song rewrites
//   identical bytes.
// - A pattern row is one string per track, so changing a step changes one line.
// - Every field a song can hold is written, including defaults, so a song sounds the
//   same after the defaults change.
//
// Parsing is strict about structure (unknown keys, bad ids and out-of-range values are
// errors naming their path) and lenient about spacing in rows and missing optional
// fields, so a hand-written song can stay short.

import {
  BPM,
  CHOKE_GROUPS,
  DELAY_PARAMS,
  INSTRUMENT_KINDS,
  INSTRUMENTS,
  type InstrumentKind,
  MASTER_PARAMS,
  MIXER_PARAMS,
  type ParamSpec,
  quantize,
  REVERB_PARAMS,
  SWING,
} from "./instruments";
import {
  ID_PATTERN,
  MAX_ARRANGEMENT,
  MAX_PATTERNS,
  MAX_TRACKS,
  type Mixer,
  type Pattern,
  type Song,
  type Track,
} from "./model";
import { emptyRow, formatRow, MAX_BARS, parseRow, RowError, STEPS_PER_BAR } from "./notation";

export const FORMAT_VERSION = 1;
export const SCHEMA_URL = "https://dnbm.a2f0.net/song.schema.json";
export const SONG_EXTENSION = ".dnbm.json";

export class SongError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = "SongError";
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string, keys: readonly string[]): Json {
  if (!isObject(value)) throw new SongError(path, "must be an object");
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw new SongError(path, `unknown key "${key}" (expected ${keys.join(", ")})`);
    }
  }
  return value;
}

function array(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value)) throw new SongError(path, "must be an array");
  if (value.length < min)
    throw new SongError(path, `needs at least ${min} entr${min === 1 ? "y" : "ies"}`);
  if (value.length > max) throw new SongError(path, `has more than ${max} entries`);
  return value;
}

function number(value: unknown, path: string, spec: ParamSpec): number {
  if (value === undefined) return spec.default;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SongError(path, "must be a number");
  }
  if (value < spec.min || value > spec.max) {
    throw new SongError(path, `${value} is outside ${spec.min} to ${spec.max}`);
  }
  return quantize(spec, value);
}

function boolean(value: unknown, path: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new SongError(path, "must be true or false");
  return value;
}

function id(value: unknown, path: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new SongError(
      path,
      "must be 1 to 16 lowercase letters, digits or hyphens, starting with a letter",
    );
  }
  return value;
}

function params(value: unknown, path: string, specs: readonly ParamSpec[]): Record<string, number> {
  const source =
    value === undefined
      ? {}
      : object(
          value,
          path,
          specs.map((spec) => spec.key),
        );
  return Object.fromEntries(
    specs.map((spec) => [spec.key, number(source[spec.key], `${path}.${spec.key}`, spec)]),
  );
}

function parseMixer(value: unknown, path: string): Mixer {
  const keys = [...MIXER_PARAMS.map((spec) => spec.key), "mute", "solo"];
  const source = value === undefined ? {} : object(value, path, keys);
  const values: Record<string, number> = Object.fromEntries(
    MIXER_PARAMS.map((spec) => [spec.key, number(source[spec.key], `${path}.${spec.key}`, spec)]),
  );
  return {
    level: values["level"] ?? 0,
    pan: values["pan"] ?? 0,
    mute: boolean(source["mute"], `${path}.mute`),
    solo: boolean(source["solo"], `${path}.solo`),
    lowcut: values["lowcut"] ?? 20,
    highcut: values["highcut"] ?? 20000,
    drive: values["drive"] ?? 0,
    reverb: values["reverb"] ?? 0,
    delay: values["delay"] ?? 0,
  };
}

function parseTrack(value: unknown, path: string): Track {
  const source = object(value, path, ["id", "instrument", "choke", "mixer", "params"]);
  const instrument = source["instrument"];
  if (
    typeof instrument !== "string" ||
    !(INSTRUMENT_KINDS as readonly string[]).includes(instrument)
  ) {
    throw new SongError(`${path}.instrument`, `must be one of ${INSTRUMENT_KINDS.join(", ")}`);
  }
  const kind = instrument as InstrumentKind;
  const choke = source["choke"] ?? 0;
  if (typeof choke !== "number" || !Number.isInteger(choke) || choke < 0 || choke > CHOKE_GROUPS) {
    throw new SongError(`${path}.choke`, `must be a whole number from 0 to ${CHOKE_GROUPS}`);
  }
  return {
    id: id(source["id"], `${path}.id`),
    instrument: kind,
    choke,
    mixer: parseMixer(source["mixer"], `${path}.mixer`),
    params: params(source["params"], `${path}.params`, INSTRUMENTS[kind].params),
  };
}

function parsePattern(value: unknown, path: string, tracks: readonly Track[]): Pattern {
  const source = object(value, path, ["id", "bars", "rows"]);
  const bars = source["bars"] ?? 1;
  if (typeof bars !== "number" || !Number.isInteger(bars) || bars < 1 || bars > MAX_BARS) {
    throw new SongError(`${path}.bars`, `must be a whole number from 1 to ${MAX_BARS}`);
  }
  const rowsSource =
    source["rows"] === undefined
      ? {}
      : object(
          source["rows"],
          `${path}.rows`,
          tracks.map((t) => t.id),
        );
  const rows: Record<string, string[]> = {};
  for (const track of tracks) {
    const melodic = INSTRUMENTS[track.instrument].melodic;
    const text = rowsSource[track.id];
    const rowPath = `${path}.rows.${track.id}`;
    if (text === undefined) {
      rows[track.id] = emptyRow(bars, melodic);
    } else if (typeof text !== "string") {
      throw new SongError(rowPath, "must be a string");
    } else {
      try {
        rows[track.id] = parseRow(text, melodic, bars * STEPS_PER_BAR);
      } catch (error) {
        if (error instanceof RowError) throw new SongError(rowPath, error.message);
        throw error;
      }
    }
  }
  return { id: id(source["id"], `${path}.id`), bars, rows };
}

function unique(ids: readonly string[], path: string, what: string): void {
  const seen = new Set<string>();
  ids.forEach((value, index) => {
    if (seen.has(value))
      throw new SongError(`${path}[${index}].id`, `duplicate ${what} id "${value}"`);
    seen.add(value);
  });
}

const SONG_KEYS = [
  "$schema",
  "dnbm",
  "title",
  "bpm",
  "swing",
  "master",
  "reverb",
  "delay",
  "tracks",
  "patterns",
  "arrangement",
];

/** Validates parsed JSON as a song, filling in defaults. Throws SongError. */
export function parseSong(data: unknown): Song {
  const source = object(data, "song", SONG_KEYS);
  if (source["dnbm"] !== FORMAT_VERSION) {
    throw new SongError("song.dnbm", `must be ${FORMAT_VERSION} (the song format version)`);
  }
  const title = source["title"] ?? "Untitled";
  if (typeof title !== "string" || title.length > 120) {
    throw new SongError("song.title", "must be a string of at most 120 characters");
  }
  const tracks = array(source["tracks"] ?? [], "song.tracks", 0, MAX_TRACKS).map((track, index) =>
    parseTrack(track, `song.tracks[${index}]`),
  );
  unique(
    tracks.map((track) => track.id),
    "song.tracks",
    "track",
  );
  const patterns = array(source["patterns"], "song.patterns", 1, MAX_PATTERNS).map(
    (pattern, index) => parsePattern(pattern, `song.patterns[${index}]`, tracks),
  );
  unique(
    patterns.map((pattern) => pattern.id),
    "song.patterns",
    "pattern",
  );
  const patternIds = new Set(patterns.map((pattern) => pattern.id));
  const arrangement = array(source["arrangement"], "song.arrangement", 1, MAX_ARRANGEMENT).map(
    (slot, index) => {
      if (typeof slot !== "string" || !patternIds.has(slot)) {
        throw new SongError(`song.arrangement[${index}]`, `"${String(slot)}" is not a pattern id`);
      }
      return slot;
    },
  );
  const master = params(source["master"], "song.master", MASTER_PARAMS);
  const reverb = params(source["reverb"], "song.reverb", REVERB_PARAMS);
  const delay = params(source["delay"], "song.delay", DELAY_PARAMS);
  return {
    title,
    bpm: number(source["bpm"], "song.bpm", BPM),
    swing: number(source["swing"], "song.swing", SWING),
    master: { level: master["level"] ?? 0, glue: master["glue"] ?? 0, drive: master["drive"] ?? 0 },
    reverb: { size: reverb["size"] ?? 0, damp: reverb["damp"] ?? 0 },
    delay: { time: delay["time"] ?? 3, feedback: delay["feedback"] ?? 0, tone: delay["tone"] ?? 0 },
    tracks,
    patterns,
    arrangement,
  };
}

/** Parses song file text. Throws SongError. */
export function parseSongText(text: string): Song {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new SongError(
      "song",
      `is not valid JSON (${error instanceof Error ? error.message : error})`,
    );
  }
  return parseSong(data);
}

function ordered(
  specs: readonly ParamSpec[],
  values: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    specs.map((spec) => [spec.key, quantize(spec, values[spec.key] ?? spec.default)]),
  );
}

/** The song as the ordered plain object its file holds. */
function toFile(song: Song): Json {
  return {
    $schema: SCHEMA_URL,
    dnbm: FORMAT_VERSION,
    title: song.title,
    bpm: quantize(BPM, song.bpm),
    swing: quantize(SWING, song.swing),
    master: ordered(MASTER_PARAMS, song.master),
    reverb: ordered(REVERB_PARAMS, song.reverb),
    delay: ordered(DELAY_PARAMS, song.delay),
    tracks: song.tracks.map((track) => {
      const { mute, solo, ...levels } = track.mixer;
      const mixer = ordered(MIXER_PARAMS, levels);
      return {
        id: track.id,
        instrument: track.instrument,
        choke: track.choke,
        mixer: {
          level: mixer["level"],
          pan: mixer["pan"],
          mute,
          solo,
          lowcut: mixer["lowcut"],
          highcut: mixer["highcut"],
          drive: mixer["drive"],
          reverb: mixer["reverb"],
          delay: mixer["delay"],
        },
        params: ordered(INSTRUMENTS[track.instrument].params, track.params),
      };
    }),
    patterns: song.patterns.map((pattern) => ({
      id: pattern.id,
      bars: pattern.bars,
      rows: Object.fromEntries(
        song.tracks.map((track) => [
          track.id,
          formatRow(
            pattern.rows[track.id] ?? emptyRow(pattern.bars, INSTRUMENTS[track.instrument].melodic),
            INSTRUMENTS[track.instrument].melodic,
          ),
        ]),
      ),
    })),
    arrangement: song.arrangement,
  };
}

/** The canonical file text: the same song always serializes to the same bytes. */
export function serializeSong(song: Song): string {
  return `${JSON.stringify(toFile(song), null, 2)}\n`;
}

/** Rounds and fills every value as saving and reloading would. Throws SongError. */
export function normalizeSong(song: Song): Song {
  return parseSongText(serializeSong(song));
}
