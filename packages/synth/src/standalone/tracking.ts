import { createTracker, type Tracker } from "@a2f0/ct-client";

declare const __DNBM_PRODUCTION__: boolean;

/** Only the standalone page entrypoints call this; embedded apps never track themselves. */
export function createSiteTracker(app: "sequencer" | "player"): Tracker | undefined {
  if (
    typeof __DNBM_PRODUCTION__ === "undefined" ||
    !__DNBM_PRODUCTION__ ||
    typeof window === "undefined" ||
    window.location.origin !== "https://dnbm.a2f0.net"
  ) {
    return undefined;
  }
  return createTracker({
    site: "dnbm",
    app,
    environment: "production",
    capture: "all",
    // The standalone site's configured preference; all other CT opt-outs remain active.
    overrideGpc: true,
    page: () => (app === "player" ? "/player" : "/"),
  });
}
