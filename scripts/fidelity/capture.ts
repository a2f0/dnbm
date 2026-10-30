// A reproducible audio checkpoint, not a musical-quality score. Keep output outside Git.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Rendered, renderSong } from "@a2f0/dnbm-synth/audio/offline";
import { WasmEngine } from "@a2f0/dnbm-synth/audio/wasmEngine";
import { encodeWav } from "@a2f0/dnbm-synth/audio/wav";
import { parseSongText, serializeSong } from "@a2f0/dnbm-synth/song/format";
import { buildEngine, ENGINE_WASM, ROOT } from "../build/build";

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Sample-domain diagnostics. RMS is unweighted; this is NOT LUFS or true peak. */
export function measure({ left, right, sampleRate }: Rendered) {
  if (left.length === 0 || left.length !== right.length) throw new Error("Invalid stereo render");
  let peak = 0;
  let energy = 0;
  let sum = 0;
  let side = 0;
  let nearFullScale = 0;
  let nonFinite = 0;
  for (let i = 0; i < left.length; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    side += ((l - r) / 2) ** 2;
    for (const sample of [l, r]) {
      if (!Number.isFinite(sample)) nonFinite++;
      peak = Math.max(peak, Math.abs(sample));
      energy += sample * sample;
      sum += sample;
      if (Math.abs(sample) >= 0.98) nearFullScale++;
    }
  }
  const count = left.length * 2;
  const rms = Math.sqrt(energy / count);
  const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : null);
  return {
    seconds: left.length / sampleRate,
    peak,
    peakDbfs: db(peak),
    rms,
    rmsDbfs: db(rms),
    crestDb: rms > 0 ? db(peak / rms) : null,
    dc: sum / count,
    sideEnergyFraction: energy > 0 ? (2 * side) / energy : 0,
    nearFullScaleFraction: nearFullScale / count,
    nonFinite,
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { rate: { type: "string", default: "48000" }, engine: { type: "string" } },
    allowPositionals: true,
  });
  const [input, destination] = positionals;
  if (!input || !destination || positionals.length !== 2) {
    throw new Error(
      "Usage: bun run fidelity:capture <song> <new-directory> [--rate 48000] [--engine path]",
    );
  }
  const sampleRate = Number(values.rate);
  if (![44100, 48000, 96000].includes(sampleRate))
    throw new Error("Rate must be 44100, 48000 or 96000");
  const text = await Bun.file(input).text();
  const replayText = serializeSong(parseSongText(text));
  const song = parseSongText(replayText);
  const output = resolve(destination);
  // Exclusive directory creation refuses to overwrite previous evidence.
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  if (!values.engine) await buildEngine();
  const wasm = new Uint8Array(await Bun.file(values.engine ?? ENGINE_WASM).arrayBuffer());
  const engine = await WasmEngine.create(wasm, sampleRate);
  // Observe the one load performed by renderSong, not an independent compilation.
  const loadSong = engine.loadSong;
  let compiled: Uint8Array | undefined;
  engine.loadSong = (data) => {
    if (compiled) throw new Error("Capture expects exactly one compiled song load");
    compiled = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    loadSong.call(engine, data);
  };
  const start = performance.now();
  let rendered: Rendered;
  try {
    rendered = renderSong(engine, song, { loops: 1, tailSeconds: 4 });
  } finally {
    engine.loadSong = loadSong;
    engine.free();
  }
  const renderSeconds = (performance.now() - start) / 1000;
  if (!compiled) throw new Error("Capture did not load a compiled song");
  const metrics = measure(rendered);
  if (metrics.nonFinite > 0 || metrics.peak > 1 || metrics.rms === 0) {
    throw new Error("Non-finite, over-full-scale or silent render: capture rejected");
  }
  const audio = new Uint8Array(encodeWav(rendered.left, rendered.right, sampleRate));
  await Bun.write(join(output, "mix.wav"), audio);
  await Bun.write(join(output, "source.dnbm.json"), text);
  await Bun.write(join(output, "song.dnbm.json"), replayText);
  await Bun.write(join(output, "song.compiled.f32"), compiled);
  await Bun.write(join(output, "engine.wasm"), wasm);
  const report = {
    version: 2,
    title: song.title,
    input: resolve(input),
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    gitStatus: execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }),
    sourceSha256: sha256(text),
    songSha256: sha256(replayText),
    compiledSha256: sha256(compiled),
    engineSha256: sha256(wasm),
    audioSha256: sha256(audio),
    sampleRate,
    tailSeconds: 4,
    frames: rendered.left.length,
    metrics,
    renderSeconds,
    realtimeFactor: metrics.seconds / renderSeconds,
  };
  // Written last: its existence denotes a completed capture.
  await Bun.write(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.info(JSON.stringify({ output, ...report }, null, 2));
}

if (import.meta.main) await main();
