// Builds the site into dist/: the engine (cargo, then wasm-opt), the page, worklet and
// export-worker bundles, the static files, the song schema and the example songs.
//
//   bun scripts/build.ts            everything
//   bun scripts/build.ts --engine   just dist/engine.wasm (what the tests load)

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseSongText } from "../web/src/song/format";
import { songSchema } from "../web/src/song/schema";

export const ROOT = join(import.meta.dir, "..");
export const DIST = join(ROOT, "dist");
export const ENGINE_WASM = join(DIST, "engine.wasm");
const WEB = join(ROOT, "web");
const SONGS = join(ROOT, "songs");
const CARGO_MANIFEST = join(ROOT, "engine", "Cargo.toml");
const CARGO_OUTPUT = join(
  ROOT,
  "engine",
  "target",
  "wasm32-unknown-unknown",
  "release",
  "dnbm_engine.wasm",
);
const STATIC_FILES = ["index.html", "styles.css", "icon.svg", "_headers"];

// Rust's default WebAssembly features. The release profile strips the section that
// would let wasm-opt detect them, so they are listed here.
const WASM_FEATURES = [
  "--enable-bulk-memory",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-multivalue",
  "--enable-reference-types",
];

async function run(command: string[]): Promise<void> {
  const process = Bun.spawn(command, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  const code = await process.exited;
  if (code !== 0) throw new Error(`${command.join(" ")} exited with ${code}`);
}

export async function buildEngine(): Promise<void> {
  await run([
    "cargo",
    "build",
    "--quiet",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--manifest-path",
    CARGO_MANIFEST,
  ]);
  const wasmOpt = Bun.which("wasm-opt");
  if (!wasmOpt) throw new Error("wasm-opt not found: run `mise install` (it pins binaryen).");
  await mkdir(DIST, { recursive: true });
  await run([wasmOpt, "-O3", ...WASM_FEATURES, CARGO_OUTPUT, "-o", ENGINE_WASM]);
  const module = new WebAssembly.Module(await Bun.file(ENGINE_WASM).arrayBuffer());
  const imports = WebAssembly.Module.imports(module);
  if (imports.length > 0) {
    throw new Error(
      `engine.wasm must not import anything, but imports ${imports.map((i) => `${i.module}.${i.name}`).join(", ")}`,
    );
  }
}

async function buildSongs(): Promise<void> {
  const destination = join(DIST, "songs");
  await mkdir(destination, { recursive: true });
  const files = (await readdir(SONGS)).filter((file) => file.endsWith(".dnbm.json")).sort();
  const index = [];
  for (const file of files) {
    const text = await Bun.file(join(SONGS, file)).text();
    index.push({ file, title: parseSongText(text).title });
    await cp(join(SONGS, file), join(destination, file));
  }
  await Bun.write(join(destination, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
}

export async function buildWeb(): Promise<void> {
  const result = await Bun.build({
    entrypoints: [
      join(WEB, "src", "main.ts"),
      join(WEB, "src", "audio", "worklet.ts"),
      join(WEB, "src", "audio", "renderWorker.ts"),
    ],
    outdir: DIST,
    naming: "[name].[ext]",
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "linked",
  });
  if (!result.success) throw new AggregateError(result.logs, "Web build failed");
  for (const file of STATIC_FILES) await cp(join(WEB, file), join(DIST, file));
  await Bun.write(join(DIST, "song.schema.json"), `${JSON.stringify(songSchema(), null, 2)}\n`);
  await buildSongs();
}

export async function build(): Promise<void> {
  await rm(DIST, { recursive: true, force: true });
  await buildEngine();
  await buildWeb();
}

if (import.meta.main) {
  if (process.argv.includes("--engine")) {
    await buildEngine();
    console.info(`Built ${ENGINE_WASM}`);
  } else {
    await build();
    console.info(`Built ${DIST}`);
  }
}
