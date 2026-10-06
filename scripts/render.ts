// Renders a song file to a 24-bit WAV with the same engine the page plays it with.
//
//   bun scripts/render.ts <song.dnbm.json> [out.wav] [--rate 48000] [--loops 1]

import { parseArgs } from "node:util";
import { renderSong } from "@a2f0/dnbm-synth/audio/offline";
import { WasmEngine } from "@a2f0/dnbm-synth/audio/wasmEngine";
import { encodeWav } from "@a2f0/dnbm-synth/audio/wav";
import { parseSongText } from "@a2f0/dnbm-synth/song/format";
import { buildEngine, ENGINE_WASM } from "./build";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    rate: { type: "string", default: "48000" },
    loops: { type: "string", default: "1" },
  },
  allowPositionals: true,
});

const [input, output = input?.replace(/(\.dnbm)?\.json$/, ".wav")] = positionals;
if (!input || !output) {
  console.error(
    "Usage: bun scripts/render.ts <song.dnbm.json> [out.wav] [--rate 48000] [--loops 1]",
  );
  process.exit(2);
}

await buildEngine();
const song = parseSongText(await Bun.file(input).text());
const engine = await WasmEngine.create(
  await Bun.file(ENGINE_WASM).arrayBuffer(),
  Number(values.rate),
);
const started = performance.now();
const rendered = renderSong(engine, song, { loops: Number(values.loops) });
const elapsed = (performance.now() - started) / 1000;
await Bun.write(output, encodeWav(rendered.left, rendered.right, rendered.sampleRate));

const seconds = rendered.left.length / rendered.sampleRate;
let peak = 0;
let sum = 0;
for (const channel of [rendered.left, rendered.right]) {
  for (const sample of channel) {
    peak = Math.max(peak, Math.abs(sample));
    sum += sample * sample;
  }
}
const rms = Math.sqrt(sum / (rendered.left.length * 2));
const db = (value: number) => (20 * Math.log10(value || 1e-9)).toFixed(1);
console.info(
  `Rendered "${song.title}" to ${output}: ${seconds.toFixed(1)} s in ${elapsed.toFixed(2)} s, ` +
    `peak ${db(peak)} dBFS, RMS ${db(rms)} dBFS`,
);
