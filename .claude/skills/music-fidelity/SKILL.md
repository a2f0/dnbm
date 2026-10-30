---
name: music-fidelity
description: Use when improving dnbm. Render, compare, and refine.
version: 0.1.0
---

# Music fidelity

Improve dnbm's synthesized dark drum and bass, compositions, sequencer and player
through evidence-backed iterations. All paths below are relative to the repo root.
Read AGENTS.md, docs/music-fidelity.md and docs/song-listening-notes.md first.

## Direction and scope

Until the owner says otherwise, dnbm and its player are greenfield. Reconsider
voices, arrangements, editing and listening UX; don't preserve a weak design
just because it exists. Retain dark musical intent, deterministic synthesis,
real-time safety, host isolation and deliberate format/API migration/versioning.
No sampled commercial recordings or generated audio binaries go into Git.

This is an agent-led loop on invocation, not model training, a background job,
autonomous runtime mutation, or permission to publish/deploy. Honor the requested
scope. A song-quality request includes the example songs, not only DSP changes.

## Choose a falsifiable improvement

1. Inspect the queue and the actual implementation. Declare the songs, sections,
   voices and player flows assessed; a sample is not a library-wide audit.
2. Turn adjectives into hypotheses: papery snare body, identical ghost/accent
   articulation, bass masking, brittle distortion, static two-bar repetition,
   weak drop/break contrast, intrusive player transport. Record the listener's
   words separately from your inference. Do not assume bit depth or aliasing
   from “8-bit-ish”; inspect the signal path.
3. Rank by audible/user impact, evidence, and bounded scope. Use one DSP cause
   per experiment. For a requested song-library pass, keep a per-song intent
   and verify the complete inventory; don't apply the same rewrite everywhere.
4. State the acceptance check before editing. Use independent signal or musical
   behavior, not constants tested against themselves. Numerical checks establish
   safety/behavior, not that a song is good. Add a failing regression first.

## Preserve the baseline

Use the pinned tools and output-capture policy in AGENTS.md. Before sound edits:

    bun run fidelity:capture songs/undertow.dnbm.json .fidelity/pass/before

This builds the real WASM and retains raw 24-bit WAV, original source.dnbm.json,
resolved song.dnbm.json with explicit defaults, the actual song.compiled.f32
engine input and engine.wasm, all with SHA-256 identities. Version-2 reports also
record sample rate, render duration and diagnostics. Output must be a new
directory; a report.json written last marks completion. A failed run
may leave an incomplete directory: retain it, choose a new name and report why.
Use --rate 44100 or 96000 for rate checks. --engine path explicitly reuses a
saved engine (its checksum, not the current Git HEAD, identifies that sound).

Name stable passages/bars for audition, including a transient-heavy drop and a
sparse section. For an engine-only experiment render the resolved song.dnbm.json
with the new engine, not the possibly abbreviated source.dnbm.json. Require the
same compiled-input hash as well as resolved score, rate and length: compiler or
notation changes can alter sound even with identical text and WASM. For composition
compare old-song/old-engine, old-song/new-engine,
and new-song/new-engine so the sources of the difference remain separable.
Create isolated probes via the normal song parser/serializer and same engine,
not an unrelated synthesizer. Keep the probes with their reports.

## Change, compare, dogfood

1. Apply the smallest correction. For songs: intentional accents and ghost notes,
   bass call/response and space, section contrast and purposeful fills; more
   notes, tracks, drive or volume do not imply quality. Preserve distinct sparse,
   half-time and aggressive identities. Run songs:fmt, never hand-format files.
2. Render a candidate and generate the local audition page:

       bun run fidelity:capture .fidelity/pass/before/song.dnbm.json .fidelity/pass/engine-after
       bun run fidelity:compare .fidelity/pass/before .fidelity/pass/engine-after .fidelity/pass/review

   Open review/index.html. Matching attenuates only, using whole-render RMS;
   it is NOT LUFS/perceptual matching, includes the tail and is only a starting
   level reference. Check the live matching status after changing a native volume
   or mute control; reload to restore the initial gains. Compare the same musical
   passage at comfortable volume; don't mistake louder or brighter for better.
   Listen in mono too.
3. Actually audition isolated voices and the full mix when audio perception is
   available. Otherwise say “rendered/measured, not listened to,” leave listener
   acceptance pending, and give the owner the portable audition page. Never
   invent a listening verdict from a waveform, spectrum or successful playback.
4. Dogfood both apps through real browser actions: select/load a song, play,
   pause/resume, stop, next/previous, seek, shuffle/repeat, and mobile-width
   overflow; check console/worklet errors and teardown. A clock advancing is
   transport evidence, not proof of good sound. Capture UI screenshots only
   through matrix's take-screenshots skill; audio evidence stays in .fidelity.
5. Run relevant Rust/audio/composition tests, then bun run check. Check finite,
   bounded output, rate/block-size parity for changed paths and real-time cost.
   Don't weaken safety checks or normalize raw evidence to hide a regression.

## Keep the loop improving

Update docs/music-fidelity.md's stable issue IDs in the same change: target,
observation vs hypothesis, evidence/locator, scope, priority, acceptance,
status, next action. Use open, measuring, needs-listening, verified, blocked,
or withdrawn. Only verified closes a gap; a DSP test passing does not close
musical acceptance. Preserve withdrawn decisions until the owner reopens them.

Keep durable signal/source reasoning and reusable procedure in docs; run receipts,
checksums, comparisons and listener notes in .fidelity and the PR. Promote approved
portable audition bundles to durable PR/storage attachments before deleting local
artifacts; never commit WAV/WASM. Each pass leaves the next useful experiment,
not a claim that fidelity is finished. Fold failed hypotheses and new constraints
back into this skill instead of accumulating session journals.

## Verification and pitfalls

- PolyBLEP oscillators already exist; distortion after them can still alias.
- Decay is time to -60 dB, not one exponential time constant. Don't globally
  lengthen envelopes without intending to alter every voice and filter contour.
- Peak <= 1 means sample-bound compliance, not true-peak safety or no saturation.
- Identify renders by saved engine, resolved score and actual compiled-input hashes;
  raw abbreviated scores and Git HEAD cannot identify parser/compiler/DSP state.
- Reject legacy v1 reports instead of guessing missing provenance. Re-capture with
  the original resolved score, saved engine and original rate into a new directory,
  then require the legacy audio hash to match. Recover old defaults/compiler
  semantics first if needed; docs/music-fidelity.md describes migration.
- Test exact WAV hashes/bytes and retained engine bytes, not merely equal RMS gains.
  Browser regressions must wait for media play events before asserting switch
  positions; paused state can change before the play event is dispatched.
- Update both regular-file copies in .agents/skills/music-fidelity and
  .claude/skills/music-fidelity, including agents/openai.yaml. These are owned by
  dnbm, not agent-tool. test/music-fidelity-skill.test.ts checks parity and entrypoints.
- A pass is complete only with reproducible artifacts, actual check results,
  declared listening limits and an updated queue. Leave unproven acceptance open.
