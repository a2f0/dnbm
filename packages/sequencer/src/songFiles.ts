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

  constructor(private readonly host: SongFilesHost) {}

  /** True once the app is gone: a picker or fetch that outlived it opens nothing. */
  private get gone(): boolean {
    return this.host.signal.aborted;
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
    // The app may go while it asks, or before the answer arrives, as when the host runs
    // a command and destroys the app at once: then it does nothing more.
    if (!(await this.confirmDiscard()) || this.gone) return;
    this.load(newSong(), undefined, undefined);
    this.host.say("New song.");
  }

  /** Loads song text, as from a file; reports errors instead of throwing. */
  openText(text: string, name: string, handle?: FileSystemFileHandle): void {
    if (this.gone) return;
    try {
      this.load(parseSongText(text), name, handle, text);
      this.host.say(`Opened ${name}.`);
    } catch (error) {
      const message = error instanceof SongError ? error.message : String(error);
      this.host.say(`Couldn't open ${name}: ${message}`, true);
    }
  }

  async open(): Promise<void> {
    // Gone by now, the app opens no picker.
    if (!(await this.confirmDiscard()) || this.gone) return;
    try {
      const file = await openSongFile();
      if (file) this.openText(file.text, file.name, file.handle);
    } catch (error) {
      this.host.say(`Couldn't open: ${error instanceof Error ? error.message : error}`, true);
    }
  }

  async openExample(file: string): Promise<void> {
    const { host } = this;
    if (!(await this.confirmDiscard()) || this.gone) return;
    try {
      const response = await fetch(host.asset(`songs/${file}`), { signal: host.signal });
      if (!response.ok) throw new Error(`${response.status}`);
      this.openText(await response.text(), file);
      this.name = undefined;
      host.render();
    } catch (error) {
      if (this.gone) return;
      host.say(`Couldn't load ${file}: ${error instanceof Error ? error.message : error}`, true);
    }
  }

  async save(saveAs = false): Promise<void> {
    const { host } = this;
    const text = serializeSong(host.store.song);
    const name = this.fileName();
    try {
      const handle = await saveSongFile(text, name, saveAs ? undefined : this.handle, host.signal);
      if (handle === null || this.gone) return;
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
