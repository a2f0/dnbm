import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderSong } from "@a2f0/dnbm-synth/audio/offline";
import { WasmEngine } from "@a2f0/dnbm-synth/audio/wasmEngine";
import { encodeWav } from "@a2f0/dnbm-synth/audio/wav";
import { parseSongText, serializeSong } from "@a2f0/dnbm-synth/song/format";
import { INSTRUMENTS } from "@a2f0/dnbm-synth/song/instruments";
import type { Browser } from "playwright-core";
import { ENGINE_WASM, ROOT } from "../scripts/build/build";
import { measure, sha256 } from "../scripts/fidelity/capture";
import { auditionPage, matchingGains } from "../scripts/fidelity/compare";
import {
  closeChrome,
  LAUNCH_TIMEOUT,
  launchChrome,
  TEARDOWN_TIMEOUT,
} from "../scripts/testing/chrome";

const PROBE_SOURCE = JSON.stringify({
  dnbm: 1,
  title: "Fidelity probe",
  bpm: 180,
  tracks: [{ id: "snare", instrument: "snare" }],
  patterns: [{ id: "a", rows: { snare: "X... o... x... X..." } }],
  arrangement: ["a"],
});

async function runScript(script: string, args: string[], preload?: string) {
  const process = Bun.spawn(
    [
      Bun.which("bun") ?? "bun",
      ...(preload ? ["--preload", preload] : []),
      join(ROOT, script),
      ...args,
    ],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  const [code, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  return { code, stderr, stdout };
}

async function capture(
  song: string,
  directory: string,
  options: { engine?: string; preload?: string } = {},
): Promise<number> {
  const result = await runScript(
    "scripts/fidelity/capture.ts",
    [song, directory, "--engine", options.engine ?? ENGINE_WASM, "--rate", "44100"],
    options.preload,
  );
  return result.code;
}

test("fidelity capture renders real audio with reproducible provenance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dnbm-fidelity-"));
  try {
    const input = join(directory, "song.dnbm.json");
    const source = PROBE_SOURCE;
    const canonical = serializeSong(parseSongText(source));
    await Bun.write(input, source);
    const output = join(directory, "capture");
    expect(await capture(input, output)).toBe(0);
    const report = await Bun.file(join(output, "report.json")).json();
    expect(report.sampleRate).toBe(44100);
    expect(report.title).toBe("Fidelity probe");
    expect(report.metrics.rms).toBeGreaterThan(0);
    expect(report.metrics.peak).toBeLessThanOrEqual(1);
    expect(report.metrics.nonFinite).toBe(0);
    expect(report.engineSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.songSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.version).toBe(2);
    expect(report.compiledSha256).toBe(
      sha256(new Uint8Array(await Bun.file(join(output, "song.compiled.f32")).arrayBuffer())),
    );
    expect(report.audioSha256).toBe(
      sha256(new Uint8Array(await Bun.file(join(output, "mix.wav")).arrayBuffer())),
    );
    expect(await Bun.file(join(output, "mix.wav")).exists()).toBe(true);
    const replayText = await Bun.file(join(output, "song.dnbm.json")).text();
    const tune = INSTRUMENTS.snare.params.find((spec) => spec.key === "tune");
    if (!tune) throw new Error("Missing snare tune parameter");
    const originalDefault = tune.default;
    const retainedEngine = new Uint8Array(
      await Bun.file(join(output, "engine.wasm")).arrayBuffer(),
    );
    expect(retainedEngine).toEqual(new Uint8Array(await Bun.file(ENGINE_WASM).arrayBuffer()));
    expect(sha256(retainedEngine)).toBe(report.engineSha256);
    const engine = await WasmEngine.create(retainedEngine, report.sampleRate);
    try {
      // Simulate a later parser default without editing source or leaking global state.
      Reflect.set(tune, "default", 300);
      expect(parseSongText(source).tracks[0]?.params["tune"]).toBe(300);
      const replay = parseSongText(replayText);
      expect(replay.tracks[0]?.params["tune"]).toBe(originalDefault);
      const rendered = renderSong(engine, replay, { loops: 1, tailSeconds: 4 });
      expect(
        sha256(new Uint8Array(encodeWav(rendered.left, rendered.right, rendered.sampleRate))),
      ).toBe(report.audioSha256);
    } finally {
      Reflect.set(tune, "default", originalDefault);
      engine.free();
    }
    expect(replayText).toBe(canonical);
    expect(report.songSha256).toBe(sha256(canonical));
    expect(await Bun.file(join(output, "source.dnbm.json")).text()).toBe(source);
    expect(report.sourceSha256).toBe(sha256(source));
    const second = join(directory, "second");
    expect(await capture(input, second, { engine: join(output, "engine.wasm") })).toBe(0);
    const secondReport = await Bun.file(join(second, "report.json")).json();
    expect(secondReport.audioSha256).toBe(report.audioSha256);
    expect(new Uint8Array(await Bun.file(join(second, "mix.wav")).arrayBuffer())).toEqual(
      new Uint8Array(await Bun.file(join(output, "mix.wav")).arrayBuffer()),
    );
    const comparison = await runScript("scripts/fidelity/compare.ts", [
      output,
      second,
      join(directory, "review"),
    ]);
    expect(comparison.code, comparison.stderr).toBe(0);
    const pair = await Bun.file(join(directory, "review/comparison.json")).json();
    expect(pair.engineOnly).toBe(true);
    expect(pair.gains[0]).toBe(pair.gains[1]);
    expect(pair.gains.every((gain: number) => gain > 0 && gain <= 1)).toBe(true);
    const html = await Bun.file(join(directory, "review/index.html")).text();
    expect(html).toContain("RMS-matched");
    expect(html).toContain("before.wav");
    expect(html).toContain("after.wav");
    // Neither capture nor comparison may silently replace previous evidence.
    expect(await capture(input, output)).not.toBe(0);
    expect(await Bun.file(join(output, "report.json")).json()).toEqual(report);
    const overwrite = await runScript("scripts/fidelity/compare.ts", [
      output,
      second,
      join(directory, "review"),
    ]);
    expect(overwrite.code).not.toBe(0);
    expect(await Bun.file(join(directory, "review/comparison.json")).json()).toEqual(pair);
    // Every retained input/output is checked before a success page can be created.
    for (const file of [
      "mix.wav",
      "source.dnbm.json",
      "song.dnbm.json",
      "song.compiled.f32",
      "engine.wasm",
    ]) {
      const path = join(second, file);
      const original = await Bun.file(path).arrayBuffer();
      await Bun.write(path, "damaged evidence");
      const damagedDirectory = join(directory, `damaged-${file}`);
      const damaged = await runScript("scripts/fidelity/compare.ts", [
        output,
        second,
        damagedDirectory,
      ]);
      expect(damaged.code).not.toBe(0);
      expect(damaged.stderr).toContain(`Capture integrity mismatch: ${file}`);
      expect(await Bun.file(join(damagedDirectory, "index.html")).exists()).toBe(false);
      expect(await Bun.file(join(damagedDirectory, "comparison.json")).exists()).toBe(false);
      await Bun.write(path, original);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("changed defaults alter new abbreviated captures but not saved resolved replays", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dnbm-fidelity-defaults-"));
  try {
    const input = join(directory, "input.dnbm.json");
    await Bun.write(input, PROBE_SOURCE);
    const before = join(directory, "before");
    const changed = join(directory, "changed");
    const replay = join(directory, "replay");
    expect(await capture(input, before)).toBe(0);
    const preload = join(directory, "defaults-change.ts");
    await Bun.write(
      preload,
      `
      import { INSTRUMENTS } from ${JSON.stringify(join(ROOT, "packages/synth/src/song/instruments.ts"))};
      Reflect.set(INSTRUMENTS.snare.params.find(spec => spec.key === "tune"), "default", 300);
    `,
    );
    const options = { preload, engine: join(before, "engine.wasm") };
    expect(await capture(input, changed, options)).toBe(0);
    expect(await capture(join(before, "song.dnbm.json"), replay, options)).toBe(0);
    const original = await Bun.file(join(before, "report.json")).json();
    const updated = await Bun.file(join(changed, "report.json")).json();
    const repeated = await Bun.file(join(replay, "report.json")).json();
    expect(updated.sourceSha256).toBe(original.sourceSha256);
    expect(updated.engineSha256).toBe(original.engineSha256);
    expect(updated.audioSha256).not.toBe(original.audioSha256);
    expect(updated.compiledSha256).not.toBe(original.compiledSha256);
    expect(repeated.audioSha256).toBe(original.audioSha256);
    expect(repeated.compiledSha256).toBe(original.compiledSha256);
    expect(repeated.songSha256).toBe(original.songSha256);
    for (const [after, engineOnly] of [
      [changed, false],
      [replay, true],
    ] as const) {
      const review = `${after}-review`;
      const result = await runScript("scripts/fidelity/compare.ts", [before, after, review]);
      expect(result.code, result.stderr).toBe(0);
      expect((await Bun.file(join(review, "comparison.json")).json()).engineOnly).toBe(engineOnly);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("compiler changes cannot be labeled engine-only with an identical saved score", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dnbm-fidelity-compiler-"));
  try {
    const input = join(directory, "input.dnbm.json");
    await Bun.write(input, serializeSong(parseSongText(PROBE_SOURCE)));
    const before = join(directory, "before");
    const after = join(directory, "after");
    expect(await capture(input, before)).toBe(0);
    const preload = join(directory, "notation-change.ts");
    const witness = join(directory, "loaded-input.bin");
    // Only this child changes notation semantics; record the actual engine boundary.
    await Bun.write(
      preload,
      `
      import { writeFileSync } from "node:fs";
      import { DRUM_VELOCITY } from ${JSON.stringify(join(ROOT, "packages/synth/src/song/notation.ts"))};
      import { WasmEngine } from ${JSON.stringify(join(ROOT, "packages/synth/src/audio/wasmEngine.ts"))};
      Reflect.set(DRUM_VELOCITY, "o", 0.2);
      const load = WasmEngine.prototype.loadSong;
      WasmEngine.prototype.loadSong = function(data) {
        writeFileSync(${JSON.stringify(witness)}, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        load.call(this, data);
        // A separate compilation after rendering would now record the wrong input.
        Reflect.set(DRUM_VELOCITY, "o", 0.9);
      };
    `,
    );
    expect(await capture(input, after, { preload, engine: join(before, "engine.wasm") })).toBe(0);
    const original = await Bun.file(join(before, "report.json")).json();
    const changed = await Bun.file(join(after, "report.json")).json();
    expect(changed.songSha256).toBe(original.songSha256);
    expect(changed.engineSha256).toBe(original.engineSha256);
    expect(changed.sampleRate).toBe(original.sampleRate);
    expect(changed.frames).toBe(original.frames);
    expect(changed.audioSha256).not.toBe(original.audioSha256);
    const review = join(directory, "review");
    const result = await runScript("scripts/fidelity/compare.ts", [before, after, review]);
    expect(result.code, result.stderr).toBe(0);
    expect((await Bun.file(join(review, "comparison.json")).json()).engineOnly).toBe(false);
    expect(changed.version).toBe(2);
    const compiled = new Uint8Array(await Bun.file(join(after, "song.compiled.f32")).arrayBuffer());
    expect(compiled).toEqual(new Uint8Array(await Bun.file(witness).arrayBuffer()));
    expect(changed.compiledSha256).toBe(sha256(compiled));
    expect(changed.compiledSha256).not.toBe(original.compiledSha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("legacy captures require an explicit recapture instead of implied provenance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dnbm-fidelity-legacy-"));
  try {
    const input = join(directory, "input.dnbm.json");
    await Bun.write(input, PROBE_SOURCE);
    const before = join(directory, "before");
    expect(await capture(input, before)).toBe(0);
    const reportPath = join(before, "report.json");
    const report = await Bun.file(reportPath).json();
    report.version = 1;
    delete report.sourceSha256;
    delete report.compiledSha256;
    await Bun.write(reportPath, JSON.stringify(report));
    const review = join(directory, "review");
    const result = await runScript("scripts/fidelity/compare.ts", [before, before, review]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Unsupported capture report version 1");
    expect(result.stderr).toContain("Re-capture into a new directory");
    expect(result.stderr).toContain("saved engine");
    expect(result.stderr).toContain("audio SHA-256");
    expect(await Bun.file(join(review, "index.html")).exists()).toBe(false);
    expect(await Bun.file(join(review, "comparison.json")).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

describe("portable fidelity audition in Chrome", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchChrome();
  }, LAUNCH_TIMEOUT);
  afterAll(async () => {
    await closeChrome(browser);
  }, TEARDOWN_TIMEOUT);

  test("loads WAVs, switches at the same position and reports changed listening levels", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dnbm-fidelity-browser-"));
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const input = join(directory, "input.dnbm.json");
      await Bun.write(input, PROBE_SOURCE);
      const before = join(directory, "before");
      const after = join(directory, "after");
      expect(await capture(input, before)).toBe(0);
      const song = parseSongText(PROBE_SOURCE);
      await Bun.write(input, serializeSong({ ...song, master: { ...song.master, level: -12 } }));
      expect(await capture(input, after)).toBe(0);
      const review = join(directory, "review");
      const compared = await runScript("scripts/fidelity/compare.ts", [before, after, review]);
      expect(compared.code, compared.stderr).toBe(0);
      const pair = await Bun.file(join(review, "comparison.json")).json();
      await page.goto(pathToFileURL(join(review, "index.html")).href);
      await page.bringToFront();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("audio")].every(
          (player) => player.readyState >= 1 && Number.isFinite(player.duration),
        ),
      );
      const metadata = await page.locator("audio").evaluateAll((players: HTMLAudioElement[]) =>
        players.map((player) => ({
          duration: player.duration,
          volume: player.volume,
          error: player.error,
        })),
      );
      expect(metadata).toHaveLength(2);
      for (const [index, player] of metadata.entries()) {
        expect(player.duration).toBeCloseTo(pair.before.frames / pair.before.sampleRate, 5);
        expect(player.volume).toBe(pair.gains[index]);
        expect(player.volume).toBeGreaterThan(0);
        expect(player.volume).toBeLessThanOrEqual(1);
        expect(player.error).toBeNull();
      }
      const [a, b] = metadata;
      if (!a || !b) throw new Error("Missing audition audio controls");
      expect(pair.gains[0]).not.toBe(pair.gains[1]);
      expect(pair.before.metrics.rms * a.volume).toBeCloseTo(pair.after.metrics.rms * b.volume, 10);
      expect(await page.locator("#matching-status").textContent()).toStartWith("RMS-matched");
      await page.locator("audio").evaluateAll((players: HTMLAudioElement[]) => {
        for (const player of players)
          player.addEventListener("play", () => {
            player.dataset["startedAt"] = String(player.currentTime);
          });
      });
      await page.locator('[data-side="0"]').click();
      await page.waitForFunction(() => {
        const a = document.querySelector("audio");
        return a && !a.paused && a.currentTime > 0;
      });
      for (const [from, to, position] of [
        [0, 1, 1.25],
        [1, 0, 2.5],
      ] as const) {
        await page
          .locator("audio")
          .nth(from)
          .evaluate((player: HTMLAudioElement, time) => {
            player.pause();
            player.currentTime = time;
          }, position);
        await page.waitForFunction(
          ({ from, position }) => {
            const player = document.querySelectorAll("audio")[from];
            return player && !player.seeking && Math.abs(player.currentTime - position) < 0.001;
          },
          { from, position },
        );
        await page
          .locator("audio")
          .nth(to)
          .evaluate((player) => {
            delete player.dataset["startedAt"];
          });
        await page.locator(`[data-side="${to}"]`).click();
        await page.waitForFunction(
          (to) =>
            [...document.querySelectorAll("audio")].every(
              (player, index) =>
                player.paused === (index !== to) &&
                (index !== to || player.dataset["startedAt"] !== undefined),
            ),
          to,
        );
        expect(
          Number(await page.locator("audio").nth(to).getAttribute("data-started-at")),
        ).toBeCloseTo(position, 3);
      }
      // Native controls dispatch this same volumechange event; matching must stay honest.
      await page
        .locator("audio")
        .nth(0)
        .evaluate(
          (player: HTMLAudioElement) =>
            new Promise<void>((resolve) => {
              player.addEventListener("volumechange", () => resolve(), { once: true });
              player.volume /= 2;
            }),
        );
      expect(await page.locator("#matching-status").textContent()).toContain("not RMS-matched");
      await page.locator('[data-side="1"]').click();
      expect(await page.locator("#matching-status").textContent()).toContain("not RMS-matched");
      await page
        .locator("audio")
        .nth(1)
        .evaluate(
          (player: HTMLAudioElement) =>
            new Promise<void>((resolve) => {
              player.addEventListener("volumechange", () => resolve(), { once: true });
              player.volume /= 2;
            }),
        );
      expect(await page.locator("#matching-status").textContent()).toStartWith("RMS-matched");
      for (const muted of [true, false]) {
        await page
          .locator("audio")
          .nth(1)
          .evaluate(
            (player: HTMLAudioElement, muted) =>
              new Promise<void>((resolve) => {
                player.addEventListener("volumechange", () => resolve(), { once: true });
                player.muted = muted;
              }),
            muted,
          );
        expect(await page.locator("#matching-status").textContent()).toContain(
          muted ? "not RMS-matched" : "RMS-matched at current control levels",
        );
      }
      expect(errors).toEqual([]);
    } finally {
      await page.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

test("diagnostics distinguish silence, mono and side energy without rating quality", () => {
  const wave = new Float32Array([0.5, -0.5, 0.5, -0.5]);
  const mono = measure({ left: wave, right: wave, sampleRate: 48000 });
  expect(mono.rms).toBe(0.5);
  expect(mono.peak).toBe(0.5);
  expect(mono.dc).toBe(0);
  expect(mono.crestDb).toBe(0);
  expect(mono.sideEnergyFraction).toBe(0);
  const side = measure({ left: wave, right: wave.map((x) => -x), sampleRate: 48000 });
  expect(side.sideEnergyFraction).toBe(1);
  const zero = new Float32Array(4);
  expect(measure({ left: zero, right: zero, sampleRate: 48000 }).rmsDbfs).toBeNull();
  expect(() => measure({ left: wave, right: new Float32Array(1), sampleRate: 48000 })).toThrow();
});

test("audition matches RMS by attenuation only and escapes song titles", () => {
  const [a, b] = matchingGains(0.2, 0.4);
  expect(0.2 * a).toBeCloseTo(0.4 * b, 10);
  expect(a).toBeLessThanOrEqual(1);
  expect(b).toBeLessThanOrEqual(1);
  const [quiet] = matchingGains(0.01, 0.4);
  expect(quiet).toBe(1);
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => matchingGains(invalid, 0.2)).toThrow();
  }
  const html = auditionPage("<script>not music</script>", [a, b], false);
  expect(html).not.toContain("<script>not music</script>");
  expect(html).toContain("NOT an engine-only comparison");
});
