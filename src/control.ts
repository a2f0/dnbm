// What each app offers the host that mounts it: the commands its instance's `run` takes,
// and the state its instance reports, for a host's window chrome (menus, a toolbar, a
// status bar) to drive and show the app without reaching into its shadow root. The shell
// (src/shell.ts) keeps each instance's state here; the apps publish theirs through
// `AppContext.onState`. Importing it never touches the DOM.

/**
 * The commands the sequencer's `run` takes, the actions of its top bar's buttons and
 * shortcuts: play, stop, or either (as Space does); a new song, open a file, save it,
 * save it as a new file, and export a WAV; undo and redo.
 */
export type DnbmSequencerCommand =
  | "play"
  | "stop"
  | "togglePlay"
  | "new"
  | "open"
  | "save"
  | "saveAs"
  | "export"
  | "undo"
  | "redo";

/** The sequencer's state, as its instance reports it. */
export interface DnbmSequencerState {
  /** The song is playing, or starting to: the play button shows stop. */
  readonly playing: boolean;
  /** The song's title, as its title field shows it. Empty until the app is ready. */
  readonly title: string;
  /** The file the song opened from or saves to, such as "undertow.dnbm.json". */
  readonly fileName: string;
  /** The song has changes since it was opened or last saved. */
  readonly dirty: boolean;
  /**
   * Which commands `run` carries out now. None are available before the app is ready,
   * while it asks something in a dialog, or once it is destroyed.
   */
  readonly available: Readonly<Record<DnbmSequencerCommand, boolean>>;
}

/**
 * The commands the player's `run` takes, the actions of its buttons and shortcuts: play
 * (or resume), pause, either (as Space does), stop, the previous and the next song, and
 * shuffle and repeat on or off.
 */
export type DnbmPlayerCommand =
  | "play"
  | "pause"
  | "togglePlay"
  | "stop"
  | "previous"
  | "next"
  | "toggleShuffle"
  | "toggleRepeat";

/** The player's state, as its instance reports it. */
export interface DnbmPlayerState {
  /** A song is playing, or starting to. */
  readonly playing: boolean;
  /** Playback is paused, and play resumes it. */
  readonly paused: boolean;
  /** The current song's title. Empty until the player is ready, or without songs. */
  readonly title: string;
  /** Songs play in a shuffled order. */
  readonly shuffle: boolean;
  /** The playlist starts over after its last song. */
  readonly repeat: boolean;
  /**
   * Which commands `run` carries out now. None are available before the player is
   * ready, without songs, or once it is destroyed.
   */
  readonly available: Readonly<Record<DnbmPlayerCommand, boolean>>;
}

/** Every command off, in the order `run` documents them. */
function unavailable<Command extends string>(
  commands: readonly Command[],
): Readonly<Record<Command, boolean>> {
  return Object.fromEntries(commands.map((command) => [command, false])) as Record<
    Command,
    boolean
  >;
}

export const SEQUENCER_COMMANDS: readonly DnbmSequencerCommand[] = [
  "play",
  "stop",
  "togglePlay",
  "new",
  "open",
  "save",
  "saveAs",
  "export",
  "undo",
  "redo",
];

export const PLAYER_COMMANDS: readonly DnbmPlayerCommand[] = [
  "play",
  "pause",
  "togglePlay",
  "stop",
  "previous",
  "next",
  "toggleShuffle",
  "toggleRepeat",
];

/**
 * The sequencer's state before it is ready and once it is destroyed: frozen, as every
 * instance shares it.
 */
export const SEQUENCER_IDLE: DnbmSequencerState = freeze({
  playing: false,
  title: "",
  fileName: "",
  dirty: false,
  available: unavailable(SEQUENCER_COMMANDS),
});

/** The player's state before it is ready and once it is destroyed, frozen likewise. */
export const PLAYER_IDLE: DnbmPlayerState = freeze({
  playing: false,
  paused: false,
  title: "",
  shuffle: false,
  repeat: false,
  available: unavailable(PLAYER_COMMANDS),
});

/** What `run` and `available` accept: a known command, never an inherited key. */
export function isCommand<Command extends string>(
  commands: readonly Command[],
  command: unknown,
): command is Command {
  return typeof command === "string" && (commands as readonly string[]).includes(command);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Equal values, comparing objects one level deep, as the states' `available` is. */
function same(a: unknown, b: unknown, depth = 1): boolean {
  if (Object.is(a, b)) return true;
  if (!isRecord(a) || !isRecord(b) || depth < 0) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key], depth - 1))
  );
}

/** A frozen copy, so a host can't change the state it is given, nor the app's. */
function freeze<State extends object>(state: State): State {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    copy[key] = isRecord(value) ? Object.freeze({ ...value }) : value;
  }
  return Object.freeze(copy) as State;
}

/** Reports a listener's error without stopping the others, as an event listener's would be. */
function report(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}

/**
 * An instance's state and its subscribers. Until `open`, the state is `idle`: the app's
 * published state waits there, as `run` takes no command before the app is ready. A
 * change replaces the snapshot at once and reaches the subscribers in a microtask, never
 * inside the app's own code, once however many changes it made in between. `close`
 * returns it to `idle` and ends every subscription without a last call.
 */
export class StateChannel<State extends object> {
  private current: State;
  private published: State | undefined;
  private notified: State;
  private readonly listeners = new Set<(state: State) => void>();
  private opened = false;
  private closed = false;
  private queued = false;

  constructor(private readonly idle: State) {
    this.current = idle;
    this.notified = idle;
  }

  get state(): State {
    return this.current;
  }

  /** Takes the app's state; the subscribers hear of it if it changed. */
  publish(state: State): void {
    if (this.closed) return;
    if (!this.opened) {
      this.published = state;
      return;
    }
    if (same(state, this.current)) return;
    this.current = freeze(state);
    this.queue();
  }

  /** The app is ready: its state shows, and the subscribers hear of it. */
  open(): void {
    if (this.closed || this.opened) return;
    this.opened = true;
    if (this.published) this.publish(this.published);
    this.published = undefined;
  }

  /** The instance is destroyed: the state is idle again, and the subscriptions end. */
  close(): void {
    this.closed = true;
    this.published = undefined;
    this.current = this.idle;
    this.listeners.clear();
  }

  subscribe(listener: (state: State) => void): () => void {
    if (this.closed || typeof listener !== "function") return () => {};
    // A wrapper, so the same function subscribed twice is called twice and each
    // unsubscribe removes only its own.
    const entry = (state: State) => listener(state);
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  private queue(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.notify();
    });
  }

  private notify(): void {
    if (this.closed) return;
    const state = this.current;
    // Every new snapshot is told, even one equal to the last told: a subscriber may
    // have read a snapshot in between, and must hear of the one that replaced it.
    if (state === this.notified) return;
    this.notified = state;
    for (const listener of [...this.listeners]) {
      // A listener can destroy the instance, or unsubscribe another.
      if (this.closed) return;
      if (!this.listeners.has(listener)) continue;
      try {
        listener(state);
      } catch (error) {
        report(error);
      }
    }
  }
}
