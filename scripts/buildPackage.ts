// Builds the publishable package: plain ESM and declarations for the two entrypoints
// in lib/, and the built app in site/ for hosts to copy and serve.
//
//   bun scripts/buildPackage.ts

import { execFileSync } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { build, DIST, ROOT } from "./build";

export const LIB = join(ROOT, "lib");
export const SITE = join(ROOT, "site");

/** Built files that only mean something to Cloudflare, at the root of a deployment. */
const DEPLOYMENT_ONLY = new Set(["_headers"]);

export async function buildPackage(): Promise<void> {
  await build();
  await rm(LIB, { recursive: true, force: true });
  await rm(SITE, { recursive: true, force: true });
  const compiler = join(
    dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
    "bin",
    "tsc",
  );
  execFileSync(process.execPath, [compiler, "-p", join(ROOT, "tsconfig.package.json")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  await cp(DIST, SITE, {
    recursive: true,
    filter: (source) => !DEPLOYMENT_ONLY.has(basename(source)),
  });
}

if (import.meta.main) {
  await buildPackage();
  console.info("Built the package: ESM and declarations in lib/, the app in site/.");
}
