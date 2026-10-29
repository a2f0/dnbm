// What the panels in ui/ see of the editor. `App` (app.ts) implements it and builds the
// panels; the panels depend on this interface, never on app.ts, so they stay below it.

import type { Pattern, Song } from "@a2f0/dnbm-synth/song/model";
import type { DnbmSequencerState } from "../../../src/control";
import type { SongStore } from "./store";
import type { Dialogs } from "./ui/dialog";
import type { View } from "./view";

/** Where the app runs: what it renders in and loads from, and how long it lives. */
export interface Environment {
  /** The app's frame in its shadow root: its keyboard, pointer and drop events. */
  readonly frame: HTMLElement;
  /** The root the frame is in, where dialogs open. */
  readonly root: Document | ShadowRoot;
  /** The slash-terminated directory the engine, worker and example songs load from. */
  readonly assets: URL;
  /** Aborts when the app goes: it then releases audio, workers, timers and frames. */
  readonly signal: AbortSignal;
  /** Receives the title the app gives its page, when it has a page of its own. */
  readonly onTitle?: ((title: string) => void) | undefined;
  /** The app shows its own buttons for its commands; false when its host shows them. */
  readonly actions: boolean;
  /** Receives the app's state for its host whenever it may have changed. */
  readonly onState?: ((state: DnbmSequencerState) => void) | undefined;
}

/** The editor's state and actions that its panels read and call. */
export interface Editor {
  readonly store: SongStore;
  readonly view: View;
  readonly dialogs: Dialogs;
  readonly environment: Environment;
  readonly song: Song;
  /** Where an asset is, such as "engine.wasm" or "songs/index.json". */
  asset(path: string): URL;
  pattern(): Pattern;
  /** Edits the song. Errors (an invalid edit) show in the status bar. */
  edit(change: (song: Song) => void, gesture?: string): void;
  endGesture(): void;
  setView(patch: Partial<View>): void;
  say(message: string, error?: boolean): void;
  togglePlay(): void;
  selectPattern(id: string, pauseFollow?: boolean): void;
  setMode(mode: View["mode"]): void;
  /** Starts song mode from a slot, or marks it as where play starts. */
  playFrom(slot: number): void;
  /** Plays a track's sound now: a hit, or a note held until `release`. */
  audition(trackIndex: number, note?: number, duration?: number): Promise<void>;
  release(trackIndex: number): void;
  newSong(): Promise<void>;
  open(): Promise<void>;
  openExample(file: string): Promise<void>;
  save(saveAs?: boolean): Promise<void>;
  exportWav(): Promise<void>;
}
