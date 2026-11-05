// The player's transport as one state machine: what the listener asked for (stopped,
// playing or paused) and, inside it, where the engine is with the selected song. Only
// `transition` changes it; the player carries out the audio, timer and display work
// around each event, so this file stays pure and its table is tested directly.

/** The engine is not playing the selected song: the next play starts it at `slot`. */
export interface Queued {
  readonly phase: "queued";
  readonly slot: number;
}

/** Where the engine is with the selected song. */
export type Engine =
  | Queued
  /** Told to play from `slot`; its reports are stale until it reports that slot's first step. */
  | { readonly phase: "starting"; readonly slot: number }
  /** Playing the song, and reporting its positions. */
  | { readonly phase: "running" }
  /**
   * The song ended; its reverb and delay ring out for `remaining` milliseconds before the
   * next song starts. The wait counts from `since` while playing, and holds while paused.
   */
  | { readonly phase: "ending"; readonly remaining: number; readonly since: number | undefined };

export type Transport =
  /** Stopped, the engine has no song playing: the next play starts it at the queued slot. */
  | { readonly status: "stopped"; readonly engine: Queued }
  | { readonly status: "playing" | "paused"; readonly engine: Engine };

export type TransportEvent =
  /** Selects a position: whatever the engine plays now is no longer the selection's. */
  | { readonly type: "queue"; readonly slot: number }
  /** Plays, or resumes from a pause, keeping the engine where it is. */
  | { readonly type: "play" }
  /** The engine was told to play the selected song from `slot`. */
  | { readonly type: "start"; readonly slot: number }
  /** The engine reported its position. */
  | {
      readonly type: "report";
      readonly playing: boolean;
      readonly slot: number;
      readonly step: number;
    }
  /** The ending's wait starts counting at `now`. */
  | { readonly type: "wait"; readonly now: number }
  /** Pauses at `now`, holding what is left of an ending's wait. */
  | { readonly type: "pause"; readonly now: number }
  | { readonly type: "stop" }
  /** The engine couldn't start. */
  | { readonly type: "fail" }
  /** The ending rang out, or was abandoned as the player went. */
  | { readonly type: "elapse" };

/** How long a finished song rings out before the next one starts. */
export const TAIL_MS = 1500;

export const STOPPED: Transport = { status: "stopped", engine: { phase: "queued", slot: 0 } };

/** Whether a play without a song resumes what the engine holds, rather than starting it. */
export function resumable(state: Transport): boolean {
  return state.status === "paused" && state.engine.phase !== "queued";
}

/** The slot a play waiting on the engine's startup starts it at; undefined when none waits. */
export function pendingStart(state: Transport): number | undefined {
  return state.status === "playing" && state.engine.phase === "queued"
    ? state.engine.slot
    : undefined;
}

/** The ending's wait, counting since `since`, when its timer should run. */
export function counting(state: Transport): { remaining: number; since: number } | undefined {
  const { engine } = state;
  return engine.phase === "ending" && engine.since !== undefined
    ? { remaining: engine.remaining, since: engine.since }
    : undefined;
}

/** Applies `event` to `state`; an event that doesn't apply in it returns `state` itself. */
export function transition(state: Transport, event: TransportEvent): Transport {
  switch (event.type) {
    case "queue":
      return withEngine(state, { phase: "queued", slot: event.slot });
    case "play":
      return state.status === "playing" ? state : { status: "playing", engine: state.engine };
    case "start":
      return state.status === "playing"
        ? { status: "playing", engine: { phase: "starting", slot: event.slot } }
        : state;
    case "report":
      return report(state, event);
    case "wait":
      return state.status === "playing" &&
        state.engine.phase === "ending" &&
        state.engine.since === undefined
        ? { status: "playing", engine: { ...state.engine, since: event.now } }
        : state;
    case "pause": {
      if (state.status !== "playing") return state;
      const { engine } = state;
      return {
        status: "paused",
        engine:
          engine.phase === "ending" && engine.since !== undefined
            ? {
                phase: "ending",
                remaining: engine.remaining - (event.now - engine.since),
                since: undefined,
              }
            : engine,
      };
    }
    case "stop":
      return STOPPED;
    case "fail":
      return state.engine.phase === "queued" ? { status: "stopped", engine: state.engine } : state;
    case "elapse":
      return state.engine.phase === "ending"
        ? withEngine(state, { phase: "queued", slot: 0 })
        : state;
    default:
      return unhandled(event);
  }
}

/** Reports before the engine took the last play or seek, or with no song playing, are stale. */
function report(state: Transport, event: Extract<TransportEvent, { type: "report" }>): Transport {
  if (state.status === "stopped") return state;
  const { engine } = state;
  switch (engine.phase) {
    case "starting":
      return event.playing && event.slot === engine.slot && event.step === 0
        ? { status: state.status, engine: { phase: "running" } }
        : state;
    case "running":
      // The engine plays a song once, and stopped as its last step ended.
      return event.playing
        ? state
        : {
            status: state.status,
            engine: { phase: "ending", remaining: TAIL_MS, since: undefined },
          };
    case "queued":
    case "ending":
      return state;
    default:
      return unhandled(engine);
  }
}

/** `state` with the engine somewhere else; stopped keeps only a queued engine. */
function withEngine(state: Transport, engine: Queued): Transport {
  return state.status === "stopped" ? { status: "stopped", engine } : { ...state, engine };
}

function unhandled(value: never): never {
  throw new Error(`Unhandled transport value: ${JSON.stringify(value)}`);
}
