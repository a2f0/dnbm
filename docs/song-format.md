# Song format

A song is a JSON file, conventionally named `<title>.dnbm.json`. The format is
designed for source control:

- **Canonical.** Keys come in a fixed order, numbers round to each parameter's step,
  and nothing volatile (timestamps, random ids) is stored. Saving an unchanged song
  rewrites identical bytes, and `bun run songs:check` refuses a file that isn't in
  canonical form.
- **Line-oriented.** A pattern row is one string, so changing a step changes one line,
  and edits to different tracks or patterns merge without conflict.
- **Explicit.** Every value a song can hold is written, defaults included, so a song
  keeps its sound when the defaults change.

`web/src/song/format.ts` is the reference implementation. Every file names the JSON
Schema at `https://dnbm.a2f0.net/song.schema.json`, so editors validate and complete
hand edits.

## Structure

```json
{
  "$schema": "https://dnbm.a2f0.net/song.schema.json",
  "dnbm": 1,
  "title": "Undertow",
  "bpm": 174,
  "swing": 0,
  "master": { "level": -1, "glue": 0.4, "drive": 0.25 },
  "reverb": { "size": 0.72, "damp": 0.68 },
  "delay": { "time": 3, "feedback": 0.45, "tone": 0.28 },
  "tracks": [ ... ],
  "patterns": [ ... ],
  "arrangement": ["intro", "intro", "build", "drop"]
}
```

| Field | Meaning |
| --- | --- |
| `dnbm` | The format version, `1` |
| `bpm` | Tempo, 60 to 220 |
| `swing` | 0 (straight) to 1 (every second sixteenth delayed to a triplet) |
| `master` | `level` in dB; `glue`, the bus compressor; `drive`, the soft clipper |
| `reverb` | `size` (decay, 0.4 to 8 s) and `damp` (how fast the tail darkens) |
| `delay` | `time` in sixteenths, `feedback` up to 0.9, `tone` from dark to bright |
| `arrangement` | Pattern ids in playing order; the song loops at the end |

Saved files write objects one key per line; the examples here are compacted.

## Tracks

```json
{
  "id": "reese",
  "instrument": "reese",
  "choke": 0,
  "mixer": { "level": -10.5, "pan": 0, "mute": false, "solo": false, "lowcut": 75,
             "highcut": 20000, "drive": 0.35, "reverb": 0.04, "delay": 0 },
  "params": { "cutoff": 480, "resonance": 0.38, "detune": 24, ... }
}
```

`id` is 1 to 16 lowercase letters, digits or hyphens, starting with a letter. Tracks
with the same nonzero `choke` group (1 to 8) cut each other off, as a closed hat cuts
an open one. The mixer `level` is in dB (-60 is silent), `pan` runs from -1 to 1,
`lowcut` and `highcut` are filter frequencies in Hz, and `reverb` and `delay` are send
levels.

| Instrument | Plays | Parameters |
| --- | --- | --- |
| `kick` | hits | `tune` Hz, `sweep` (start pitch multiple), `bend` s, `decay` s, `click` |
| `snare` | hits | `tune` Hz, `tone` (body against noise), `decay` s, `snap` |
| `hat` | hits | `tone` (pitch multiple), `decay` s, `metal` (squares against noise) |
| `perc` | hits | `tune` Hz, `decay` s, `bend`, `noise` |
| `sub` | notes | `glide` s, `attack` s, `release` s, `warmth` |
| `reese` | notes | `cutoff` Hz, `resonance`, `detune` cents, `sub`, `env`, `decay` s, `rate` (wobble cycle in sixteenths), `wobble`, `glide` s, `release` s |
| `pluck` | notes | `tone`, `decay`, `release` s |

Ranges and defaults live in `web/src/song/instruments.ts` and in the schema.

## Patterns

```json
{
  "id": "drop",
  "bars": 2,
  "rows": {
    "kick": "X... .... ..X. .... | ..X. .... ..X. ....",
    "sub": "F-1 --- --- ---  --- --- ... F-1  --- ... F-1 ---  F#1 --- --- ... | ..."
  }
}
```

A pattern is 1 to 4 bars of sixteenth-note steps (16 per bar), with a row for every
track. A missing row is all rests.

**Hit rows** (kick, snare, hat, perc) take one character per step:

| Symbol | Step |
| --- | --- |
| `.` | rest |
| `o` | ghost (velocity 0.4, about -12 dB) |
| `x` | hit (0.75) |
| `X` | accent (1.0) |

**Note rows** (sub, reese, pluck) take a three-character token per step:

| Token | Step |
| --- | --- |
| `F-1`, `G#2` | a note: letter, `-` or `#`, octave (C-0 to B-8; F-1 is 43.65 Hz) |
| `---` | tie: hold the note through this step |
| `...` | rest: release the note |

A note sounds until a rest. On `sub` and `reese`, a note that follows a held note
glides to it without retriggering, as on a monophonic synth.

Parsing ignores spacing and `|`, and accepts `F1`, `Gb1` and lowercase letters.
Saving writes rows canonically: hit rows group four steps per beat, note rows separate
beats with two spaces, and ` | ` separates bars.
