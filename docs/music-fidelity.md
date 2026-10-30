# Music fidelity

A maintained opportunity queue for synthesized dark drum and bass, composition,
and the player. Adapted from Skyline's building-fidelity loop: evidence, a bounded
change, reproducible comparison, regression, and a discoverable next experiment.
It does not train a model, rewrite songs at runtime or schedule itself.

Until the owner changes direction, both dnbm and its player are greenfield. The
current design and example arrangements are candidates, not preservation targets.
Dark intent, safe host embedding and reliable audio remain requirements.

## Acceptance and evidence

Separate three questions:

1. **Technical:** valid songs, finite/bounded signal, correct timing, deterministic
   output, reasonable render cost and working browser transport.
2. **Measured behavior:** a specific spectral/envelope/groove defect changes as
   intended. Loudness, oscillator count or note density are not quality scores.
3. **Listening:** named listeners compare corresponding passages and prefer the
   result for stated reasons. Without audio perception, report “rendered/measured,
   not listened to.” Do not infer enjoyment from successful playback.

Statuses: `open`, `measuring`, `needs-listening`, `verified`, `blocked`, `withdrawn`.
Only `verified` closes the stated gap. A musical change remains `needs-listening`
after tests pass; remaining problems receive separate IDs, not blanket closure.

## Opportunity queue

Last assessed: 2026-10-30. Initial scope: the shared signal path, all eleven example
songs, and sequencer/player transport. No commercial reference recording has been
claimed as a listening benchmark.

| ID     | Target and evidence                                                              | Priority / reason                                                                                               | Status          | Acceptance and next action                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MF-001 | Snare ghost/accent articulation; [signal evidence](#snare-articulation)          | High: ghost notes previously differed only in gain, weakening authored accents                                  | needs-listening | Normalized attack treble differs across velocities at 44.1/48/96 kHz; audition isolated strokes and dense/sparse mixes before accepting the chosen cutoff curve           |
| MF-002 | Master gain depends on render block size; [render parity](#render-parity)        | High: browser/offline comparisons must agree                                                                    | verified        | Fresh-WASM stereo regressions cover non-unity initial gain and fixed-sample target changes at 44.1/48 kHz, block sizes 1/128/441/4096; channel edit parity remains MF-007 |
| MF-003 | Example-library development; [per-song notes](song-listening-notes.md)           | High: stronger drums/bass/sections must live in the songs, not only the engine                                  | needs-listening | Revise and render every listed example, validate individual composition intentions, and compare equivalent sections at matched level; owner listening still required      |
| MF-004 | Mixer saturation is sample-rate nonlinear processing after filtering             | Medium: folded harmonics are a plausible harshness source, not a proven explanation of the listener's complaint | open            | Isolate coherent high-frequency fixtures; investigate filtered oversampling/ADAA with alias-energy, gain, bandwidth, latency and CPU regressions before changing it       |
| MF-005 | Snare partials share one decay; hat/perc articulation remains limited            | Medium: more convincing body/wires and cymbal motion may be worthwhile                                          | open            | Separate body/wire envelope experiment with fixed groove, source-backed hypothesis, blind/level-matched listener comparison; do not globally change decay semantics       |
| MF-006 | Player as an audition/listening surface                                          | Medium: listening workflow is part of fidelity, not just skin                                                   | open            | Dogfood controls and mobile fit; next consider phrase/section navigation and reference A/B without mixing editing state into the player                                   |
| MF-007 | Channel gain/filter edit smoothing still uses block endpoints                    | Medium: live mixer-edit parity is narrower than static-song parity                                              | open            | Reproduce fixed-sample channel edits; design block-independent smoothing with measured CPU cost before extending MF-002's guarantee                                       |
| MF-008 | Corrosion low-frequency/DC offset; [diagnostic](#low-frequency-offset-follow-up) | Medium: preserve bass headroom without assuming a listening defect                                              | open            | Isolate per-channel and nonlinear-stage DC, then evaluate a bounded correction with bass/transient tests and matched listening                                            |

## Reproducible comparisons

Run from the root with pinned tools; capture noisy commands through `agent:run`
as AGENTS.md specifies. These names are normal package-script entrypoints:

```sh
bun run fidelity:capture songs/undertow.dnbm.json .fidelity/pass/before
# Change the engine, then render the identical saved song:
bun run fidelity:capture .fidelity/pass/before/song.dnbm.json .fidelity/pass/engine-after
bun run fidelity:compare .fidelity/pass/before .fidelity/pass/engine-after .fidelity/pass/engine-review
# Separately compare the revised composition:
bun run fidelity:capture songs/undertow.dnbm.json .fidelity/pass/song-after
bun run fidelity:compare .fidelity/pass/engine-after .fidelity/pass/song-after .fidelity/pass/song-review
```

Open each review's `index.html`. A version-2 capture retains:

- `source.dnbm.json`: the original input text, unchanged, including omitted fields.
- `song.dnbm.json`: the resolved canonical replay score with all defaults explicit.
- `song.compiled.f32`: the exact Float32Array bytes passed to the engine by
  `renderSong` (the compiled song layout, not audio). Capture observes that load;
  it does not compile a second, potentially different input for the artifact.
- `engine.wasm` and `mix.wav`: the actual engine bytes and raw 24-bit render.
- `report.json`, written last: SHA-256 identities for all five artifacts, Git
  HEAD/working status, sample rate, four-second tail, raw sample peak, RMS,
  crest factor, DC, side-energy fraction, fraction near full scale and render time.

Replay `song.dnbm.json`, not `source.dnbm.json`, to freeze omitted defaults.
These are unweighted sample-domain diagnostics, not LUFS, true peak or a mastering
certificate. Render cost is an offline indication, not an AudioWorklet deadline guarantee.

A saved engine can be selected with `--engine path`; that engine's hash identifies
the actual DSP, even when the current source differs. Supported rates: `--rate
44100`, `48000` (default), `96000`. Captures/comparisons require a new directory and
refuse overwrite. A failed capture can leave an incomplete directory; a missing
report is not success. Use a new name, do not erase evidence to retry silently.

Comparison checks every artifact checksum before copying both WAVs beside its
page. Engine-only labeling requires identical resolved scores, compiled inputs,
sample rates and frame counts: saved text alone cannot freeze compiler or notation
semantics. A changed compiled identity therefore disables that label even when the
score and WASM are identical.

Initial gains only attenuate, matching whole-render RMS down to at most -20 dBFS.
This includes silence and the tail, so it is a starting reference, not perceptual
or per-passage matching. The page updates its matching status when either native
volume or mute control changes; proportional nonzero attenuation of both sides
preserves matching. Reload the page to restore the initial gains. Switching A/B
retains elapsed seconds, not musical section alignment: use corresponding bars
when arrangements differ. Keep the page and WAVs together. A hash mismatch rejects
altered evidence.

### Legacy captures

Version-1 reports are rejected with recapture instructions; do not change their
version number or synthesize missing provenance. Preserve the old directory, then
capture the original fully resolved score into a new directory with the retained
engine and original sample rate, for example:

```sh
bun run fidelity:capture original-resolved.dnbm.json .fidelity/pass/before-v2 --engine .fidelity/pass/before/engine.wasm --rate 48000
```

Verify the new `audioSha256` equals the legacy report's value before treating it
as the same baseline. If the old input omitted fields, recover the original
defaults and compiler/notation semantics first; today's expansion cannot establish
the old sound. If the audio hash differs or the old semantics are unavailable,
keep the old capture as historical evidence and mark reproduction blocked.

Raw and audition audio stays in gitignored `.fidelity/`; never commit binaries.
Retain the portable bundle and manifest as a durable review attachment before
cleaning local artifacts. Record run-specific checks and listener observations in
that bundle or the PR, not an accumulating journal in this guide.

## Snare articulation

Observed in `packages/synth/engine/src/instruments/snare.rs`: a seeded hit at
velocity 0.4 was effectively the same waveform as velocity 1, scaled by gain.
The first regression compared high-passed (4 kHz) energy / total energy over the
first 20 ms. Before the change, the ratios were effectively equal at 44.1 kHz
(0.5467333 vs 0.5467322). This is a level-independent behavior check, not a sound
quality verdict.

The new wire/noise-path low-pass opens with squared strike velocity while leaving
the pitched body outside it. Noise remains seeded and timing deterministic. The
2.5–18 kHz curve is an explicit sound-design choice, not a measured acoustic fit.
The test requires accent attack treble fraction to exceed the ghost by 20% at
44.1, 48 and 96 kHz. Audition whether ghosts now sit behind the backbeat without
losing useful definition; do not count the numeric threshold as listener approval.
No song fields, instrument parameter positions or format version change.

Source inspected 2026-10-30: Gordon Reid, “Synthesizing Drums: The Snare Drum,”
Sound On Sound, March 2002,
<https://www.soundonsound.com/techniques/synthesizing-drums-snare-drum>.
The author's discussion surrounding figures 12–15 connects harder strikes with a
larger high-frequency share and proposes velocity-controlled noise filtering.
That supports the qualitative direction, not this implementation's cutoff values.

Further hypothesis, not implemented here: Gordon Reid, “Practical Snare Drum
Synthesis,” Sound On Sound, April 2002,
<https://www.soundonsound.com/techniques/practical-snare-drum-synthesis>.
The discussion around figures 4–6 describes independently shaped body partials
and noise bands. Use this to test MF-005, not to claim an acoustic snare replica.

## Render parity

The shared WASM does not by itself guarantee identical live/export sound. The
master began at unity and approached its target with a block-dependent linear
ramp. Existing parity tests used a unity master and missed this. Test nonzero
master level and fixed-sample target changes on both channels before trusting
null comparisons. The master now advances one-pole gain smoothing once per sample
with its original 10 ms time constant; the regression requires exact stereo sample
equality across block sizes 1/128/441/4096 at 44.1/48 kHz. A Rust test independently
checks the analytical time constant and bounded output. Channel edits and
distortion are distinct queue items.

## Low-frequency offset follow-up

The retained Corrosion comparisons show increased positive whole-render DC after
its score/timbre changes, while the engine-only change barely moves that metric.
This is a signal diagnostic, not an audible verdict. Investigate per-channel and
per-stage means, waveform asymmetry and low-frequency energy before choosing a
DC blocker or a voice/mix change; any correction needs bass/transient regressions.

## Working the loop

The repo-owned skill lives in matching `.agents/skills/music-fidelity` and
`.claude/skills/music-fidelity` copies. `test/music-fidelity-skill.test.ts` guards
copy parity, the queue and runnable entrypoints. `test/fidelity.test.ts` covers
real capture, diagnostics and audition generation. Existing engine tests still
cover deterministic voices, finite output, full-scale bounds and every example
song; composition tests must assert actual musical properties, not merely bytes.

On each invocation, revisit listener feedback, pick the highest-impact supported
gap, retain the baseline, test one hypothesis, and update the queue with what is
still unknown. The owner can withdraw or redirect a target; retain the decision
instead of silently reintroducing it on the next pass.
