// Decides whether the publish workflow releases package.json's version to npm,
// printing the reason and, under GitHub Actions, setting the step's `publish` output.
// Adapted from a2f0/skyline's scripts/npm-publish-decision.ts.
//
//   bun scripts/npmPublishDecision.ts
//
// Only a version newer than npm's latest publishes, so a merge that keeps the version,
// a re-run, and a run that finishes after a newer release all succeed without
// publishing, and the latest tag never moves backwards.

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REGISTRY = "https://registry.npmjs.org";

/** Every version npm has for the package, and its latest tag. */
export interface RegistryState {
  readonly latest: string;
  readonly versions: readonly string[];
}

export interface PublishDecision {
  readonly publish: boolean;
  readonly reason: string;
}

// Plain major.minor.patch, as ship-pr bumps; a prerelease published without a
// dist-tag would become npm's latest.
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function decidePublish(version: string, state: RegistryState): PublishDecision {
  if (!VERSION.test(version))
    throw new Error(`invalid package version: ${JSON.stringify(version)}`);
  if (state.versions.includes(version))
    return { publish: false, reason: `${version} is already on npm` };
  if (Bun.semver.order(version, state.latest) <= 0) {
    return {
      publish: false,
      reason: `${version} is not newer than npm's latest (${state.latest})`,
    };
  }
  return { publish: true, reason: `${version} is newer than npm's latest (${state.latest})` };
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

/**
 * Parses `npm view <name> versions dist-tags --json`, which prints versions as a
 * string rather than an array when only one exists. A package npm doesn't have yet
 * fails: npm adds a trusted publisher only to an existing package, so its first
 * version is published by hand.
 */
export function parseRegistryState(json: string): RegistryState {
  const view: unknown = JSON.parse(json);
  if (field(field(view, "error"), "code") === "E404") {
    throw new Error(
      "the package is not on npm yet; publish its first version by hand, then add the trusted publisher (docs/package.md)",
    );
  }
  const versions = field(view, "versions");
  const latest = field(field(view, "dist-tags"), "latest");
  const list: unknown = typeof versions === "string" ? [versions] : versions;
  if (
    typeof latest !== "string" ||
    !Array.isArray(list) ||
    !list.every((v) => typeof v === "string")
  ) {
    throw new Error(`unexpected npm view output: ${json}`);
  }
  return { latest, versions: list };
}

function readRegistryState(name: string): RegistryState {
  // A scope registry in the runner's npm config overrides --registry, so the scope is
  // pinned as well.
  const scope = name.split("/")[0];
  const result = spawnSync(
    "npm",
    [
      "view",
      name,
      "versions",
      "dist-tags",
      "--json",
      "--registry",
      REGISTRY,
      `--${scope}:registry=${REGISTRY}`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (result.error) throw result.error;
  // A failed view, including a missing package, still prints a JSON error.
  const state = result.stdout.trim() ? parseRegistryState(result.stdout) : undefined;
  if (result.status !== 0 || !state)
    throw new Error(`npm view ${name} exited with ${result.status}`);
  return state;
}

if (import.meta.main) {
  try {
    const metadata: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    );
    const name = field(metadata, "name");
    const version = field(metadata, "version");
    if (typeof name !== "string" || typeof version !== "string") {
      throw new Error("package.json needs a name and a version.");
    }
    const decision = decidePublish(version, readRegistryState(name));
    console.info(
      decision.publish
        ? `Publishing ${name}: ${decision.reason}.`
        : `::notice::Not publishing ${name}: ${decision.reason}.`,
    );
    const output = process.env["GITHUB_OUTPUT"];
    if (output) appendFileSync(output, `publish=${decision.publish}\n`);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
