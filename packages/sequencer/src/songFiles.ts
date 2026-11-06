// The song's file: starting a new song, opening one from a file, an example or a drop,
// and saving, with the discard prompt before anything replaces unsaved edits. `App`
// (app.ts) owns one and hands it what it needs as a `SongFilesHost`.

import { newSong } from "@a2f0/dnbm-synth/song/defaults";
import { parseSongText, SongError, serializeSong } from "@a2f0/dnbm-synth/song/format";
import type { Song } from "@a2f0/dnbm-synth/song/model";
import type { SongStore } from "./store";
import type { Dialogs } from "./ui/dialog";
import { openSongFile, saveSongFile, songFileName } from "./ui/files";
import type { View } from "./view";

/** What the song's file needs of the editor. */
export interface SongFilesHost {
  readonly store: SongStore;
  readonly view: View;
  readonly dialogs: Dialogs;
  /** Aborts when the app goes: work that outlived it then changes nothing. */
  readonly signal: AbortSignal;
  /** Where an asset is, such as "songs/wraith.dnbm.json". */
  asset(path: string): URL;
  say(message: string, error?: boolean): void;
  render(): void;
  stop(): void;
  /** Writes the song and its saved text to browser storage. */
  autosave(): void;
}

export class SongFiles {
  private handle: FileSystemFileHandle | undefined;
  private name: string | undefined;
  /**
   * Counts the requests that replace the song: new, open, an example, a drop. Each one
   * waits (for the discard prompt, a picker, a fetch, a file's text) before it loads, and
   * only the latest may load: an earlier one finishing later would replace the song the
   * user opened since, and any edits to it, without asking.
   */
  private request = 0;
  /** Counts the songs loaded, so a save can tell the song it wrote was replaced since. */
  private loads = 0;

  constructor(private readonly host: SongFilesHost) {}

  /** True once the app is gone: a picker or fetch that outlived it opens nothing. */
  private get gone(): boolean {
    return this.host.signal.aborted;
  }

  /** Starts a request that will replace the song, superseding any still waiting. */
  private begin(): number {
    return ++this.request;
  }

  /** The request may go on: no later one started, and the app is still here. */
  private current(request: number): boolean {
    return request === this.request && !this.gone;
  }

  /** The file the song opened from or saves to. */
  fileName(): string {
    return this.name ?? songFileName(this.host.store.song.title);
  }

  private load(
    song: Song,
    name: string | undefined,
    handle: FileSystemFileHandle | undefined,
    text?: string,
  ): void {
    const { host } = this;
    host.stop();
    this.loads += 1;
    this.handle = handle;
    this.name = name;
    host.view.startSlot = 0;
    host.view.patternId = song.patterns[0]?.id ?? "a";
    host.view.trackId = song.tracks[0]?.id ?? "";
    host.store.load(song, text);
  }

  /** Whether the song may be replaced: it has no unsaved edits, or the user agrees. */
  async confirmDiscard(): Promise<boolean> {
    return (
      !this.host.store.dirty ||
      (await this.host.dialogs.confirm("Discard unsaved changes to this song?", "discard"))
    );
  }

  async newSong(): Promise<void> {
    const request = this.begin();
    // The app may go while it asks, or before the answer arrives, as when the host runs
    // a command and destroys the app at once: then it does nothing more.
    if (!(await this.confirmDiscard()) || !this.current(request)) return;
    this.load(newSong(), undefined, undefined);
    this.host.say("New song.");
  }

  /** Loads song text, as from a file; reports errors instead of throwing. */
  openText(text: string, name: string, handle?: FileSystemFileHandle): void {
    if (!this.current(this.begin())) return;
    try {
      this.load(parseSongText(text), name, handle, text);
      this.host.say(`Opened ${name}.`);
    } catch (error) {
      const message = error instanceof SongError ? error.message : String(error);
      this.host.say(`Couldn't open ${name}: ${message}`, true);
    }
  }

  async open(): Promise<void> {
    const request = this.begin();
    // Gone by now, the app opens no picker.
    if (!(await this.confirmDiscard()) || !this.current(request)) return;
    try {
      const file = await openSongFile();
      if (file && this.current(request)) this.openText(file.text, file.name, file.handle);
    } catch (error) {
      if (!this.current(request)) return;
      this.host.say(`Couldn't open: ${error instanceof Error ? error.message : error}`, true);
    }
  }

  /** Opens a song file dropped on the app, once any unsaved edits may be discarded. */
  async openDropped(file: File): Promise<void> {
    const request = this.begin();
    if (!(await this.confirmDiscard()) || !this.current(request)) return;
    const text = await file.text();
    if (this.current(request)) this.openText(text, file.name);
  }

  async openExample(file: string): Promise<void> {
    const { host } = this;
    const request = this.begin();
    if (!(await this.confirmDiscard()) || !this.current(request)) return;
    try {
      const response = await fetch(host.asset(`songs/${file}`), { signal: host.signal });
      if (!response.ok) throw new Error(`${response.status}`);
      const text = await response.text();
      if (!this.current(request)) return;
      this.openText(text, file);
      this.name = undefined;
      host.render();
    } catch (error) {
      if (!this.current(request)) return;
      host.say(`Couldn't load ${file}: ${error instanceof Error ? error.message : error}`, true);
    }
  }

  async save(saveAs = false): Promise<void> {
    const { host } = this;
    const text = serializeSong(host.store.song);
    const name = this.fileName();
    // A song loaded while this one saved is not the file written: it keeps its own.
    const loads = this.loads;
    try {
      const handle = await saveSongFile(text, name, saveAs ? undefined : this.handle, host.signal);
      if (handle === null || this.gone) return;
      if (loads !== this.loads) {
        host.say(handle ? `Saved ${handle.name}.` : `Downloaded ${name}.`);
        return;
      }
      this.handle = handle;
      this.name = handle?.name ?? name;
      host.store.markSaved(text);
      host.autosave();
      host.render();
      host.say(handle ? `Saved ${this.name}.` : `Downloaded ${name}.`);
    } catch (error) {
      if (this.gone) return;
      host.say(`Couldn't save: ${error instanceof Error ? error.message : error}`, true);
    }
  }
}
