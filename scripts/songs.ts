// Keeps song files canonical, so they diff and merge cleanly.
//
//   bun scripts/songs.ts check [files...]   fail on any invalid or non-canonical song
//   bun scripts/songs.ts fmt [files...]     rewrite songs canonically
//
// Without files, both cover songs/*.dnbm.json.

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseSongText, SONG_EXTENSION, serializeSong } from "@a2f0/dnbm-synth/song/format";

const ROOT = join(import.meta.dir, "..");

async function songFiles(paths: string[]): Promise<string[]> {
  if (paths.length > 0) return paths;
  const directory = join(ROOT, "songs");
  return (await readdir(directory))
    .filter((file) => file.endsWith(SONG_EXTENSION))
    .sort()
    .map((file) => join(directory, file));
}

const [command, ...paths] = process.argv.slice(2);
if (command !== "check" && command !== "fmt") {
  console.error("Usage: bun scripts/songs.ts check|fmt [files...]");
  process.exit(2);
}

let failed = false;
for (const file of await songFiles(paths)) {
  const name = relative(process.cwd(), file);
  const text = await Bun.file(file).text();
  let canonical: string;
  try {
    canonical = serializeSong(parseSongText(text));
  } catch (error) {
    console.error(`${name}: ${error instanceof Error ? error.message : error}`);
    failed = true;
    continue;
  }
  if (canonical === text) continue;
  if (command === "fmt") {
    await Bun.write(file, canonical);
    console.info(`Formatted ${name}`);
  } else {
    console.error(`${name}: not canonical; run bun run songs:fmt`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
