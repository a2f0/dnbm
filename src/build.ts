// The build-time entrypoint of the @a2f0/dnbm package, for Node 22+ or Bun build
// scripts, never browser code.

import { cp, mkdir } from "node:fs/promises";

/**
 * Copies the complete app (the sequencer's and the player's pages and scripts, the
 * AudioWorklet, the WebAssembly engine and the example songs) into a host's static
 * directory. Serve that directory over HTTP, keeping its relative paths, and pass its
 * URL to `mountDnbm` or `mountDnbmPlayer`. Files are added, not
 * cleared: use a dedicated directory.
 */
export async function copyDnbmAssets(destination: string | URL): Promise<void> {
  await mkdir(destination, { recursive: true });
  await cp(new URL("../site/", import.meta.url), destination, { recursive: true });
}
