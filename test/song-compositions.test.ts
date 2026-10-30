import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { parseSong } from "@a2f0/dnbm-synth/song/format";
import type { Pattern, Song } from "@a2f0/dnbm-synth/song/model";

// These are arrangement contracts, not an assertion that a score sounds good.
// Each return answers a different motif; the named spaces must remain sparse.
const compositions = [
  ["bathyal", "descent", "undertide", "vent", "still"],
  ["blackwater", "swamp", "backwash", "sluice", "fog"],
  ["catacomb", "crypt", "ossuary", "stair", "half"],
  ["corrosion", "grind", "fracture", "quench", "rust"],
  ["hex", "curse", "sigil", "summon", "trance"],
  ["leviathan", "breach", "undertide", "soundings", "lull"],
  ["mire", "pull", "drag", "reed", "slow"],
  ["oubliette", "chains", "keyhole", "threshold", "dark"],
  ["sever", "slash", "scissor", "splice", "blade"],
  ["undertow", "roll", "undertide", "eddy", "space"],
  ["wraith", "apparition", "afterimage", "unveil", "veil"],
] as const;
const songsUrl = new URL("../songs/", import.meta.url);

function pattern(song: Song, id: string): Pattern {
  const found = song.patterns.find((entry) => entry.id === id);
  if (!found) throw new Error(`${song.title} is missing ${id}`);
  expect(song.arrangement).toContain(id);
  return found;
}

function row(entry: Pattern, id: string): string[] {
  const found = entry.rows[id];
  if (!found) throw new Error(`${entry.id} is missing ${id}`);
  return found;
}

// Follow ties, rather than counting note tokens as if every note were a stab.
// The inspected bass phrases start with a note or rest, not an inherited tie.
function gates(tokens: string[]): boolean[] {
  let held = false;
  return tokens.map((token) => {
    if (token !== "---") held = token !== "...";
    return held;
  });
}

const isHit = (token: string) => /^[oxX]$/.test(token);
const hits = (tokens: string[]) => tokens.filter(isHit).length;

function bassId(song: Song): string {
  const bass = song.tracks.find((track) => track.instrument === "reese");
  if (!bass) throw new Error(`${song.title} has no mid-bass voice`);
  return bass.id;
}

function chokeCollisions(song: Song): string[] {
  const hats = song.tracks.filter((track) => track.instrument === "hat" && track.choke > 0);
  return song.patterns.flatMap((entry) =>
    hats.flatMap((hat, index) =>
      hats.slice(index + 1).flatMap((other) => {
        if (hat.choke !== other.choke) return [];
        const otherRow = row(entry, other.id);
        return row(entry, hat.id).flatMap((token, step) =>
          isHit(token) && isHit(otherRow[step] ?? ".")
            ? [`${entry.id}:${step}:${hat.id}/${other.id}`]
            : [],
        );
      }),
    ),
  );
}

test("the composition review covers every shipped example", async () => {
  const files = (await readdir(songsUrl)).filter((file) => file.endsWith(".dnbm.json")).sort();
  expect(files).toEqual(compositions.map(([slug]) => `${slug}.dnbm.json`).sort());
});

for (const [slug, motifId, returnId, bridgeId, spaceId] of compositions) {
  describe(slug, () => {
    const load = async () =>
      parseSong(JSON.parse(await readFile(new URL(`${slug}.dnbm.json`, songsUrl), "utf8")));

    test("gives the main bass phrase both solo answers and shared breathing room", async () => {
      const song = await load();
      const motif = pattern(song, motifId);
      const sub = gates(row(motif, "sub"));
      const mid = gates(row(motif, bassId(song)));
      expect(sub.filter((on, step) => on && !mid[step]).length).toBeGreaterThanOrEqual(4);
      expect(mid.filter((on, step) => on && !sub[step]).length).toBeGreaterThanOrEqual(4);
      expect(sub.filter((on, step) => !on && !mid[step]).length).toBeGreaterThanOrEqual(8);
    });

    test("accents the hat pulse without double-triggering its choke group", async () => {
      const song = await load();
      const motif = pattern(song, motifId);
      const hat = song.tracks.find((track) => track.instrument === "hat");
      if (!hat) throw new Error(`${song.title} has no hat`);
      expect(new Set(row(motif, hat.id))).toEqual(new Set([".", "o", "x", "X"]));
      expect(row(motif, "ghost")).toContain("o");
      expect(chokeCollisions(song)).toEqual([]);
    });

    test("returns with a new bass/drum answer after a bass-release transition", async () => {
      const song = await load();
      const motif = pattern(song, motifId);
      const answer = pattern(song, returnId);
      const bridge = pattern(song, bridgeId);
      const bass = bassId(song);
      expect(row(answer, "sub")).not.toEqual(row(motif, "sub"));
      expect(row(answer, bass)).not.toEqual(row(motif, bass));
      expect(row(answer, "kick")).not.toEqual(row(motif, "kick"));
      expect(row(answer, "snare")).not.toEqual(row(motif, "snare"));
      expect(
        song.arrangement.some(
          (id, index) => id === bridgeId && song.arrangement[index + 1] === returnId,
        ),
      ).toBe(true);
      for (const id of ["sub", bass]) {
        expect(row(bridge, id).slice(-4)).toEqual(["...", "...", "...", "..."]);
      }
      expect(hits(row(bridge, "ghost").slice(-8))).toBeGreaterThan(0);
    });

    test("keeps the named sparse section at no more than one main snare per bar", async () => {
      const song = await load();
      const space = pattern(song, spaceId);
      const snares = row(space, "snare");
      for (let start = 0; start < snares.length; start += 16) {
        expect(hits(snares.slice(start, start + 16))).toBeLessThanOrEqual(1);
      }
      expect(hits(row(space, "kick"))).toBeLessThanOrEqual(space.bars * 2);
    });
  });
}
