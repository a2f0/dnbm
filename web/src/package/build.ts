// The build-time entrypoint of the @a2f0/dnbm package, for Node 22+ or Bun build
// scripts, never browser code.

import { cp, mkdir } from "node:fs/promises";

/**
 * Copies the complete app (page, scripts, AudioWorklet, WebAssembly engine and
 * example songs) into a host's static directory. Serve that directory over HTTP,
 * keeping its relative paths, and pass its URL to `mountDnbm`. Files are added, not
 * cleared: use a dedicated directory.
 */
export async function copyDnbmAssets(destination: string | URL): Promise<void> {
  await mkdir(destination, { recursive: true });
  await cp(new URL("../site/", import.meta.url), destination, { recursive: true });
}
