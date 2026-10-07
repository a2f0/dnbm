// The editor: connects the song store, the view, the audio engine and the panels.

import { EngineHost, type PlayingPosition } from "@a2f0/dnbm-synth/audio/engineHost";
import type { RenderReply, RenderRequest } from "@a2f0/dnbm-synth/audio/renderWorker";
import { PlayMode } from "@a2f0/dnbm-synth/audio/wasmEngine";
import { newSong } from "@a2f0/dnbm-synth/song/defaults";
import { parseSongText, SongError, serializeSong } from "@a2f0/dnbm-synth/song/format";
import { INSTRUMENTS } from "@a2f0/dnbm-synth/song/instruments";
import type { Pattern, Song, Track } from "@a2f0/dnbm-synth/song/model";
import { type ChangeSource, SongStore } from "./store";
import { DevicePanel } from "./ui/device";
import { Dialogs } from "./ui/dialog";
import { h, isTyping } from "./ui/dom";
import { download, openSongFile, saveSongFile, songFileName } from "./ui/files";
import { Grid } from "./ui/grid";
import { MixerPanel } from "./ui/mixer";
import { PatternBar } from "./ui/patternBar";
import { Scope } from "./ui/scope";
import { Transport } from "./ui/transport";
import type { View } from "./view";

export const AUTOSAVE_KEY = "dnbm:song";
export const SAVED_KEY = "dnbm:saved";

/** Reads browser storage, which can throw (private windows, blocked storage). */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is a convenience; the song still lives in memory and in saved files.
  }
}

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
}

/**
 * Starts a module worker. Browsers only start workers from the page's origin, so a
 * script on another origin (assets served with CORS) loads through a same-origin shim.
 * `end` terminates the worker and frees the shim.
 */
function moduleWorker(url: URL): { readonly worker: Worker; end(): void } {
  if (url.origin === location.origin) {
    const worker = new Worker(url, { type: "module" });
    return { worker, end: () => worker.terminate() };
  }
  const shim = new Blob([`import ${JSON.stringify(url.href)};`], { type: "text/javascript" });
  const shimUrl = URL.createObjectURL(shim);
  const worker = new Worker(shimUrl, { type: "module" });
  return {
    worker,
    end: () => {
      worker.terminate();
      URL.revokeObjectURL(shimUrl);
    },
  };
}

export class App {
  readonly store: SongStore;
  readonly view: View;
  readonly dialogs: Dialogs;
  private host: EngineHost | undefined;
  private starting: Promise<EngineHost | undefined> | undefined;
  private playbackRequest = 0;
  private readonly auditions = new Map<number, symbol>();
  private keyboardNavigation = false;
  private syncQueued = false;
  private fileHandle: FileSystemFileHandle | undefined;
  private fileName: string | undefined;
  private readonly transport: Transport;
  private readonly patternBar: PatternBar;
  private readonly grid: Grid;
  private readonly device: DevicePanel;
  private readonly mixer: MixerPanel;
  private readonly scope: Scope;
  private readonly status: HTMLElement;
  private readonly fileLabel: HTMLElement;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private syncFrame: number | undefined;

  constructor(
    root: HTMLElement,
    song: Song,
    savedText: string | undefined,
    readonly environment: Environment,
  ) {
    this.store = new SongStore(song, savedText);
    this.dialogs = new Dialogs(environment.root, environment.frame, environment.signal);
    this.view = {
      patternId: song.patterns[0]?.id ?? "a",
      trackId: song.tracks[0]?.id ?? "",
      cursor: undefined,
      mode: "song",
      startSlot: 0,
      follow: true,
      playing: false,
      position: undefined,
      penNotes: new Map(),
    };
    this.scope = new Scope(environment.signal);
    this.transport = new Transport(this, this.scope);
    this.patternBar = new PatternBar(this);
    this.grid = new Grid(this);
    this.device = new DevicePanel(this);
    this.mixer = new MixerPanel(this);
    this.status = h("span", { class: "status-message", role: "status", "aria-live": "polite" });
    this.fileLabel = h("span", { class: "status-file" });
    root.append(
      this.transport.element,
      this.patternBar.element,
      h("div", { class: "editor" }, [this.grid.element]),
      h("section", { class: "lower" }, [this.device.element, this.mixer.element]),
      h("footer", { class: "statusbar" }, [
        this.fileLabel,
        this.status,
        h("span", {
          class: "status-help",
          text: "space play · click steps · right-click clears · drag a note to hold it · ⌘Z undo · ⌘S save",
        }),
      ]),
    );
    this.store.subscribe((next, source) => this.changed(next, source));
    this.listen();
    environment.signal.addEventListener("abort", () => this.dispose(), { once: true });
    this.render();
  }

  /** Where an asset is, such as "engine.wasm" or "songs/index.json". */
  asset(path: string): URL {
    return new URL(path, this.environment.assets);
  }

  /** Runs `callback` after `delay` milliseconds, unless the app goes first. */
  later(callback: () => void, delay: number): void {
    if (this.gone) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
  }

  /** Releases what outlives the app's DOM, once the app goes. */
  private dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.syncFrame !== undefined) cancelAnimationFrame(this.syncFrame);
    this.host = undefined;
  }

  get song(): Song {
    return this.store.song;
  }

  pattern(): Pattern {
    const { patterns } = this.song;
    return (
      patterns.find((pattern) => pattern.id === this.view.patternId) ?? (patterns[0] as Pattern)
    );
  }

  patternIndex(): number {
    return Math.max(
      0,
      this.song.patterns.findIndex((pattern) => pattern.id === this.view.patternId),
    );
  }

  track(): Track | undefined {
    return this.song.tracks.find((track) => track.id === this.view.trackId);
  }

  /** Edits the song. Errors (an invalid edit) show in the status bar. */
  edit(change: (song: Song) => void, gesture?: string): void {
    try {
      this.store.update(change, gesture);
    } catch (error) {
      this.say(error instanceof Error ? error.message : String(error), true);
    }
  }

  endGesture(): void {
    this.store.endGesture();
  }

  setView(patch: Partial<View>): void {
    Object.assign(this.view, patch);
    this.render();
  }

  say(message: string, error = false): void {
    this.status.textContent = message;
    this.status.classList.toggle("error", error);
  }

  private changed(song: Song, source: ChangeSource): void {
    const { view } = this;
    if (!song.patterns.some((pattern) => pattern.id === view.patternId)) {
      view.patternId = song.patterns[0]?.id ?? "a";
    }
    if (!song.tracks.some((track) => track.id === view.trackId)) {
      view.trackId = song.tracks[0]?.id ?? "";
    }
    view.startSlot = Math.min(view.startSlot, song.arrangement.length - 1);
    if (source === "load") view.cursor = undefined;
    this.queueSync();
    this.autosave();
    this.render();
  }

  render(): void {
    const { song, view } = this;
    this.transport.update(song, view, this.store);
    this.patternBar.update(song, view);
    this.grid.update(song, view);
    const position = view.position;
    this.grid.playhead(
      view.playing && position?.playing && song.patterns[position.pattern]?.id === view.patternId
        ? position.step
        : undefined,
    );
    this.device.update(song, view);
    this.mixer.update(song, view);
    const name = this.fileName ?? songFileName(song.title);
    this.fileLabel.textContent = `${this.store.dirty ? "● " : ""}${name}`;
    this.environment.onTitle?.(`${this.store.dirty ? "● " : ""}${song.title} · dnbm`);
  }

  private queueSync(): void {
    if (this.syncQueued || !this.host) return;
    this.syncQueued = true;
    this.syncFrame = requestAnimationFrame(() => {
      this.syncFrame = undefined;
      this.syncQueued = false;
      this.host?.loadSong(this.song);
    });
  }

  /** True once the app is gone: work that outlived it must not touch storage. */
  private get gone(): boolean {
    return this.environment.signal.aborted;
  }

  /**
   * Saves the song to local storage on every change, never later: an embedding host
   * can destroy the app at any moment, and a delayed write would be lost. Once the app
   * is gone it writes nothing, so a file picker or a drop that outlives it can't
   * overwrite what the app mounted in its place saves.
   */
  private autosave(): void {
    if (this.gone) return;
    writeStorage(AUTOSAVE_KEY, serializeSong(this.song));
    writeStorage(SAVED_KEY, this.store.saved);
  }

  /** Starts the audio engine on first use; browsers only allow it after a gesture. */
  private engine(): Promise<EngineHost | undefined> {
    const { signal } = this.environment;
    this.starting ??= EngineHost.start(
      this.asset("engine.wasm"),
      this.asset("worklet.js"),
      signal,
    ).then(
      (host) => {
        this.host = host;
        host.onPosition = (position) => this.positioned(position);
        host.onMeters = (levels) => this.mixer.meters(levels);
        host.onError = (message) => this.say(`Engine: ${message}`, true);
        host.loadSong(this.song);
        this.scope.attach(host.analyser);
        return host;
      },
      (error: unknown) => {
        if (signal.aborted) return undefined;
        this.starting = undefined;
        this.say(`Couldn't start audio: ${error instanceof Error ? error.message : error}`, true);
        return undefined;
      },
    );
    return this.starting;
  }

  private positioned(position: PlayingPosition): void {
    const { view, song } = this;
    view.position = position;
    if (!position.playing) {
      if (view.playing) this.setView({ playing: false });
      this.grid.playhead(undefined);
      this.patternBar.playing(undefined);
      this.transport.update(song, view, this.store);
      return;
    }
    const playingId = song.patterns[position.pattern]?.id;
    if (view.mode === "song" && view.follow && playingId && playingId !== view.patternId) {
      this.setView({ patternId: playingId });
    }
    this.grid.playhead(playingId === view.patternId ? position.step : undefined);
    this.patternBar.playing(view.mode === "song" ? position.slot : undefined);
    this.transport.position(song, position);
  }

  async play(): Promise<void> {
    const request = ++this.playbackRequest;
    this.setView({ playing: true });
    const host = await this.engine();
    // The app may have gone while the engine was awaited.
    if (request !== this.playbackRequest || this.gone) return;
    if (!host) {
      this.setView({ playing: false });
      return;
    }
    this.mixer.resetPeak();
    if (this.view.mode === "song") host.play(PlayMode.Song, this.view.startSlot);
    else host.play(PlayMode.Pattern, this.patternIndex());
    this.setView({ playing: true });
  }

  stop(): void {
    this.playbackRequest++;
    this.auditions.clear();
    this.host?.stop();
    this.setView({ playing: false });
  }

  togglePlay(): void {
    if (this.view.playing) this.stop();
    else void this.play();
  }

  selectPattern(id: string, pauseFollow = false): void {
    this.setView({
      patternId: id,
      cursor: undefined,
      ...(pauseFollow && this.view.playing && this.view.mode === "song" ? { follow: false } : {}),
    });
    if (this.view.playing && this.view.mode === "loop")
      this.host?.cue(PlayMode.Pattern, this.patternIndex());
  }

  setMode(mode: View["mode"]): void {
    this.setView({ mode });
    if (!this.view.playing) return;
    if (mode === "loop") this.host?.cue(PlayMode.Pattern, this.patternIndex());
    else this.host?.cue(PlayMode.Song, this.view.position?.slot ?? this.view.startSlot);
  }

  /** Starts song mode from a slot, or marks it as where play starts. */
  playFrom(slot: number): void {
    const id = this.song.arrangement[slot];
    this.setView({ startSlot: slot, mode: "song", follow: true, ...(id ? { patternId: id } : {}) });
    if (this.view.playing) this.host?.play(PlayMode.Song, slot);
  }

  /** Plays a track's sound now: a hit, or a note held until `release`. */
  async audition(trackIndex: number, note?: number, duration?: number): Promise<void> {
    const track = this.song.tracks[trackIndex];
    if (!track) return;
    const spec = INSTRUMENTS[track.instrument];
    const pitch = note ?? this.view.penNotes.get(track.id) ?? spec.defaultNote;
    const token = Symbol();
    this.auditions.set(trackIndex, token);
    const host = await this.engine();
    if (!host || this.gone || this.auditions.get(trackIndex) !== token) return;
    const current = this.song.tracks[trackIndex];
    if (current?.id !== track.id || current.instrument !== track.instrument) return;
    host.trigger(trackIndex, spec.melodic ? 1 : 0.85, pitch);
    if (duration !== undefined) {
      this.later(() => {
        if (this.auditions.get(trackIndex) === token) this.release(trackIndex);
      }, duration);
    }
  }

  release(trackIndex: number): void {
    this.auditions.delete(trackIndex);
    this.host?.release(trackIndex);
  }

  private load(
    song: Song,
    name: string | undefined,
    handle: FileSystemFileHandle | undefined,
    text?: string,
  ): void {
    this.stop();
    this.fileHandle = handle;
    this.fileName = name;
    this.view.startSlot = 0;
    this.view.patternId = song.patterns[0]?.id ?? "a";
    this.view.trackId = song.tracks[0]?.id ?? "";
    this.store.load(song, text);
  }

  private async confirmDiscard(): Promise<boolean> {
    return (
      !this.store.dirty ||
      (await this.dialogs.confirm("Discard unsaved changes to this song?", "discard"))
    );
  }

  async newSong(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.load(newSong(), undefined, undefined);
    this.say("New song.");
  }

  /** Loads song text, as from a file; reports errors instead of throwing. */
  openText(text: string, name: string, handle?: FileSystemFileHandle): void {
    if (this.gone) return;
    try {
      this.load(parseSongText(text), name, handle, text);
      this.say(`Opened ${name}.`);
    } catch (error) {
      const message = error instanceof SongError ? error.message : String(error);
      this.say(`Couldn't open ${name}: ${message}`, true);
    }
  }

  async open(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    try {
      const file = await openSongFile();
      if (file) this.openText(file.text, file.name, file.handle);
    } catch (error) {
      this.say(`Couldn't open: ${error instanceof Error ? error.message : error}`, true);
    }
  }

  async openExample(file: string): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    try {
      const response = await fetch(this.asset(`songs/${file}`), {
        signal: this.environment.signal,
      });
      if (!response.ok) throw new Error(`${response.status}`);
      this.openText(await response.text(), file);
      this.fileName = undefined;
      this.render();
    } catch (error) {
      if (this.environment.signal.aborted) return;
      this.say(`Couldn't load ${file}: ${error instanceof Error ? error.message : error}`, true);
    }
  }

  async save(saveAs = false): Promise<void> {
    const text = serializeSong(this.song);
    const name = this.fileName ?? songFileName(this.song.title);
    try {
      const handle = await saveSongFile(
        text,
        name,
        saveAs ? undefined : this.fileHandle,
        this.environment.signal,
      );
      if (handle === null || this.gone) return;
      this.fileHandle = handle;
      this.fileName = handle?.name ?? name;
      this.store.markSaved(text);
      this.autosave();
      this.render();
      this.say(handle ? `Saved ${this.fileName}.` : `Downloaded ${name}.`);
    } catch (error) {
      if (this.gone) return;
      this.say(`Couldn't save: ${error instanceof Error ? error.message : error}`, true);
    }
  }

  async exportWav(): Promise<void> {
    const { signal } = this.environment;
    this.say("Rendering…");
    try {
      const wasm = await fetch(this.asset("engine.wasm"), { signal }).then((response) =>
        response.arrayBuffer(),
      );
      // Gone while the engine loaded: start no worker, which an abort that already
      // happened would never stop.
      if (signal.aborted) return;
      const { worker, end } = moduleWorker(this.asset("renderWorker.js"));
      const request: RenderRequest = { wasm, song: this.song, sampleRate: 48_000 };
      let stop = () => {};
      const wav = await new Promise<ArrayBuffer>((resolve, reject) => {
        stop = () => reject(signal.reason);
        signal.addEventListener("abort", stop, { once: true });
        worker.onmessage = (event: MessageEvent<RenderReply>) => {
          const reply = event.data;
          if (reply.type === "progress")
            this.say(`Rendering… ${Math.round(reply.fraction * 100)}%`);
          else if (reply.type === "done") resolve(reply.wav);
          else reject(new Error(reply.message));
        };
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage(request, [wasm]);
      }).finally(() => {
        signal.removeEventListener("abort", stop);
        end();
      });
      if (signal.aborted) return;
      const name = songFileName(this.song.title).replace(/\.dnbm\.json$/, ".wav");
      download(new Blob([wav], { type: "audio/wav" }), name);
      this.say(`Exported ${name}.`);
    } catch (error) {
      if (signal.aborted) return;
      this.say(`Couldn't export: ${error instanceof Error ? error.message : error}`, true);
    }
  }

  /** The action a key press triggers, if any. Typing in a field keeps undo and space. */
  private shortcut(event: KeyboardEvent): (() => void) | undefined {
    // A dialog (ui/dialog.ts) owns the keyboard: Space presses its buttons.
    if (this.environment.root.querySelector("dialog[open]")) return undefined;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const typing = isTyping(event.target);
    if (!command) {
      const button = event.target instanceof HTMLElement && event.target.closest("button");
      return event.key === " " && !typing && !(button && this.keyboardNavigation)
        ? () => this.togglePlay()
        : undefined;
    }
    if (key === "s") return () => void this.save(event.shiftKey);
    if (key === "o") return () => void this.open();
    if (typing) return undefined;
    if (key === "y" || (key === "z" && event.shiftKey)) return () => this.store.redo();
    if (key === "z") return () => this.store.undo();
    return undefined;
  }

  /**
   * Shortcuts and dropped files act on this app only: its frame takes focus on a press
   * anywhere inside it, so its keys arrive there, and keys elsewhere on the host page
   * never do.
   */
  private listen(): void {
    const { frame, root } = this.environment;
    frame.addEventListener("pointerdown", () => {
      this.keyboardNavigation = false;
    });
    frame.addEventListener("keydown", (event) => {
      if (event.key === "Tab" || event.key === "Enter") this.keyboardNavigation = true;
      const action = this.shortcut(event);
      if (!action) return;
      event.preventDefault();
      action();
    });
    // Drop a song file anywhere on the app to open it. A drop on an open dialog does
    // nothing, rather than letting the browser open the file in place of the page.
    root.addEventListener("dragover", (event) => event.preventDefault());
    root.addEventListener("drop", async (event) => {
      event.preventDefault();
      const file = (event as DragEvent).dataTransfer?.files[0];
      if (!file || root.querySelector("dialog[open]")) return;
      if (await this.confirmDiscard()) this.openText(await file.text(), file.name);
    });
  }
}
