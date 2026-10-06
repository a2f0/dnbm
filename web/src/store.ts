// Holds the song being edited, with undo and redo. Every edit produces a new,
// normalized Song (rounded exactly as saving would round it), so what is on screen,
// what plays, and what saves always agree.

import { normalizeSong, serializeSong } from "./song/format";
import type { Song } from "./song/model";

const HISTORY_LIMIT = 200;

export type ChangeSource = "edit" | "load" | "undo" | "redo";
type Listener = (song: Song, source: ChangeSource) => void;

export class SongStore {
  private current: Song;
  private readonly undoStack: Song[] = [];
  private readonly redoStack: Song[] = [];
  /** Consecutive edits with the same key (one knob drag) share an undo step. */
  private gesture: string | undefined;
  private readonly listeners = new Set<Listener>();
  private savedText: string;

  constructor(song: Song, savedText = serializeSong(song)) {
    this.current = song;
    this.savedText = savedText;
  }

  get song(): Song {
    return this.current;
  }

  /** True when the song differs from what was last opened or saved. */
  get dirty(): boolean {
    return serializeSong(this.current) !== this.savedText;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(source: ChangeSource): void {
    for (const listener of this.listeners) listener(this.current, source);
  }

  /**
   * Applies an edit to a copy of the song. Edits sharing a `gesture` key in a row
   * become one undo step; call `endGesture` when the gesture ends.
   */
  update(edit: (song: Song) => void, gesture?: string): void {
    const draft = structuredClone(this.current);
    edit(draft);
    const next = normalizeSong(draft);
    if (serializeSong(next) === serializeSong(this.current)) return;
    if (gesture === undefined || gesture !== this.gesture) {
      this.undoStack.push(this.current);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.gesture = gesture;
    this.redoStack.length = 0;
    this.current = next;
    this.emit("edit");
  }

  endGesture(): void {
    this.gesture = undefined;
  }

  /** Replaces the song and its history, as when opening a file. */
  load(song: Song, savedText = serializeSong(song)): void {
    this.current = song;
    this.savedText = savedText;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.gesture = undefined;
    this.emit("load");
  }

  markSaved(text = serializeSong(this.current)): void {
    this.savedText = text;
  }

  get saved(): string {
    return this.savedText;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.current);
    this.current = previous;
    this.gesture = undefined;
    this.emit("undo");
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.current);
    this.current = next;
    this.gesture = undefined;
    this.emit("redo");
  }
}
