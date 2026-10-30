// Make a portable local audition page. No uploads, remote scripts, or louder-is-better scoring.
import { cp, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { sha256 } from "./capture";

interface Capture {
  version: number;
  title: string;
  sourceSha256: string;
  songSha256: string;
  compiledSha256: string;
  engineSha256: string;
  audioSha256: string;
  sampleRate: number;
  frames: number;
  metrics: { rms: number; peak: number };
}

async function readCapture(directory: string): Promise<Capture> {
  const report: Capture = await Bun.file(join(directory, "report.json")).json();
  if (report.version !== 2) {
    throw new Error(
      `Unsupported capture report version ${report.version}. Re-capture into a new directory ` +
        "using the original resolved score and saved engine; verify its audio SHA-256 against " +
        "the legacy report. See docs/music-fidelity.md for migration instructions.",
    );
  }
  if (
    typeof report.title !== "string" ||
    ![44100, 48000, 96000].includes(report.sampleRate) ||
    !Number.isSafeInteger(report.frames) ||
    report.frames <= 0 ||
    !Number.isFinite(report.metrics?.rms) ||
    report.metrics.rms <= 0 ||
    !Number.isFinite(report.metrics.peak) ||
    report.metrics.peak <= 0 ||
    report.metrics.peak > 1
  )
    throw new Error("Invalid or silent capture report");
  for (const [file, expected] of [
    ["mix.wav", report.audioSha256],
    ["source.dnbm.json", report.sourceSha256],
    ["song.dnbm.json", report.songSha256],
    ["song.compiled.f32", report.compiledSha256],
    ["engine.wasm", report.engineSha256],
  ] as const) {
    const actual = sha256(new Uint8Array(await Bun.file(join(directory, file)).arrayBuffer()));
    if (actual !== expected) throw new Error(`Capture integrity mismatch: ${file}`);
  }
  return report;
}

export function matchingGains(beforeRms: number, afterRms: number): [number, number] {
  if (![beforeRms, afterRms].every((rms) => Number.isFinite(rms) && rms > 0 && rms <= 1)) {
    throw new Error("Cannot match invalid or silent audio");
  }
  // Attenuate only, to -20 dBFS RMS or the quieter source. Unweighted, not LUFS.
  const target = Math.min(0.1, beforeRms, afterRms);
  return [target / beforeRms, target / afterRms];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function auditionPage(title: string, gains: [number, number], engineOnly: boolean): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>dnbm fidelity — ${escapeHtml(title)}</title>
<style>body{font:16px system-ui;background:#111;color:#ddd;max-width:54rem;margin:3rem auto;padding:1rem}button,audio{margin:.5rem 0}button{padding:.7rem;background:#333;color:#eee;border:1px solid #777;cursor:pointer}section{margin:2rem 0}audio{display:block;width:100%}small{color:#aaa}</style></head>
<body><h1>${escapeHtml(title)}</h1><p>A/B audition. Start at a comfortable listening volume.</p>
<p>${engineOnly ? "Same resolved song, compiled input, rate and length: isolate engine changes." : "Composition, compiler input or render settings changed: this is NOT an engine-only comparison. Compare corresponding musical sections, not just timestamps."}</p>
<p>Initial gains attenuate both sources to the same whole-render RMS (including the tail); this is not LUFS matching or a musical-quality score. Volume and mute changes update the matching status below. Listen for punch, body, groove, bass separation and fatigue. Only one side plays at a time.</p>
<p id="matching-status" role="status">RMS matching not checked (JavaScript required).</p>
<section><h2>A — Before</h2><button type="button" data-side="0">Play / switch to A</button><audio controls preload="metadata" src="before.wav" data-gain="${gains[0]}"></audio></section>
<section><h2>B — After</h2><button type="button" data-side="1">Play / switch to B</button><audio controls preload="metadata" src="after.wav" data-gain="${gains[1]}"></audio></section>
<p id="status" role="status">Not yet auditioned. A passing render does not establish a preferred sound.</p>
<script>
const players = [...document.querySelectorAll('audio')];
let active = null;
function updateMatching() {
  const scales = players.map(player => player.muted ? 0 : player.volume / Number(player.dataset.gain));
  const matched = scales.every(scale => scale > 0) && Math.abs(scales[0] - scales[1]) <= 1e-6 * Math.max(...scales);
  document.querySelector('#matching-status').textContent = matched
    ? 'RMS-matched at current control levels (whole render, not LUFS).'
    : 'Levels are not RMS-matched: volume or mute changed. Reload this page to restore the initial gains.';
}
for (const player of players) {
  player.volume = Number(player.dataset.gain);
  player.addEventListener('volumechange', updateMatching);
  player.addEventListener('play', () => {
    for (const other of players) if (other !== player) other.pause();
    active = player;
  });
  player.addEventListener('error', () => { document.querySelector('#status').textContent = 'Audio failed to load; keep the WAV files beside this page.'; });
}
updateMatching();
for (const button of document.querySelectorAll('button[data-side]')) button.addEventListener('click', async () => {
  const player = players[Number(button.dataset.side)];
  const time = active && active !== player ? active.currentTime : player.currentTime;
  for (const other of players) if (other !== player) other.pause();
  if (Number.isFinite(player.duration)) player.currentTime = Math.min(time, Math.max(0, player.duration - .01));
  try { await player.play(); document.querySelector('#status').textContent = 'Playing ' + (button.dataset.side === '0' ? 'before' : 'after') + '. Record your preference and the passage; no automatic verdict.'; }
  catch { document.querySelector('#status').textContent = 'Playback blocked or unavailable. Try the audio controls.'; }
});
</script></body></html>\n`;
}

async function main(): Promise<void> {
  const [beforePath, afterPath, outputPath, ...extra] = process.argv.slice(2);
  if (!beforePath || !afterPath || !outputPath || extra.length) {
    throw new Error(
      "Usage: bun run fidelity:compare <before-directory> <after-directory> <new-directory>",
    );
  }
  const before = await readCapture(beforePath);
  const after = await readCapture(afterPath);
  const gains = matchingGains(before.metrics.rms, after.metrics.rms);
  const engineOnly =
    before.songSha256 === after.songSha256 &&
    before.compiledSha256 === after.compiledSha256 &&
    before.sampleRate === after.sampleRate &&
    before.frames === after.frames;
  const output = resolve(outputPath);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  await cp(join(beforePath, "mix.wav"), join(output, "before.wav"));
  await cp(join(afterPath, "mix.wav"), join(output, "after.wav"));
  await Bun.write(join(output, "index.html"), auditionPage(after.title, gains, engineOnly));
  await Bun.write(
    join(output, "comparison.json"),
    `${JSON.stringify({ before, after, gains, engineOnly }, null, 2)}\n`,
  );
  console.info(JSON.stringify({ output, gains, engineOnly }, null, 2));
}

if (import.meta.main) await main();
