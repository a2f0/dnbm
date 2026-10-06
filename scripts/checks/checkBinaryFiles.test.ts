// Runs the binary-file guard against throwaway repositories that use this repository's
// .gitattributes, so an attribute that makes git treat binary content as text (such as
// "diff") can't quietly let binaries through. Every sound in dnbm is synthesized, so
// nothing binary belongs in Git.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "scripts", "checks", "checkBinaryFiles.sh");
const ATTRIBUTES = await Bun.file(join(ROOT, ".gitattributes")).text();
// Isolated from the user's git config: no hooks, no signing, a fixed identity.
const GIT_CONFIG = [
  ["core.hooksPath", "/dev/null"],
  ["commit.gpgsign", "false"],
  ["user.name", "test"],
  ["user.email", "test@example.com"],
].flatMap(([key, value]) => ["-c", `${key}=${value}`]);

/** Bytes git sees as binary: they include NUL. */
const BINARY = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 1]);

const repositories: string[] = [];

afterEach(() => {
  for (const path of repositories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), "dnbm-binary-guard-"));
  repositories.push(cwd);
  const git = (...args: string[]) => {
    const result = spawnSync("git", [...GIT_CONFIG, ...args], { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  };
  const write = (path: string, content: string | Uint8Array) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  /** The guard's exit status. */
  const guard = (...args: string[]) =>
    spawnSync("sh", [SCRIPT, ...args], { cwd, encoding: "utf8" }).status;
  git("init", "--quiet", "--initial-branch=main");
  write(".gitattributes", ATTRIBUTES);
  return { git, write, guard };
}

describe("binary file guard", () => {
  test("allows text: code, songs and SVG", () => {
    const repo = repository();
    repo.write("packages/player/src/main.ts", "export {};\n");
    repo.write("songs/song.dnbm.json", '{ "dnbm": 1 }\n');
    repo.write("packages/sequencer/icon.svg", "<svg></svg>\n");
    repo.git("add", "-A");
    expect(repo.guard("--staged")).toBe(0);
    expect(repo.guard("--all")).toBe(0);
  });

  test("blocks binary files when staged", () => {
    const repo = repository();
    repo.write("samples/kick.wav", BINARY);
    repo.git("add", "-A");
    expect(repo.guard("--staged")).toBe(1);
    expect(repo.guard("--all")).toBe(1);
  });

  test("blocks binary content in a song file, whatever .gitattributes says", () => {
    const repo = repository();
    repo.write("songs/broken.dnbm.json", BINARY);
    repo.git("add", "-A");
    expect(repo.guard("--staged")).toBe(1);
  });

  test("blocks binary files in a pushed range", () => {
    const repo = repository();
    repo.write("README.md", "dnbm\n");
    repo.git("add", "-A");
    repo.git("commit", "--quiet", "-m", "chore: start");
    repo.write("dist/engine.wasm", BINARY);
    repo.git("add", "-A");
    repo.git("commit", "--quiet", "-m", "feat: add a binary");
    expect(repo.guard("--range", "HEAD~1..HEAD")).toBe(1);
  });
});
