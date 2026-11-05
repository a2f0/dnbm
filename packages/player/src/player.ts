// The player: a playlist of songs, a display and transport controls in the spirit of
// a classic desktop music player, all driving the same engine as the sequencer. It
// edits nothing; it only plays the songs it is given.

import { EngineHost, type PlayingPosition } from "@a2f0/dnbm-synth/audio/engineHost";
import { PlayMode } from "@a2f0/dnbm-synth/audio/wasmEngine";
import type { Song } from "@a2f0/dnbm-synth/song/model";
import { STEPS_PER_BAR } from "@a2f0/dnbm-synth/song/notation";
import type { DnbmPlayerCommand, DnbmPlayerState } from "../../../src/control";
import { h, icon, setText } from "./dom";
import { Playlist } from "./playlist";
import { Spectrum } from "./spectrum";
import { clock, slotAt, stepAt, type Timeline, timeline } from "./timeline";
import {
  counting,
  pendingStart,
  resumable,
  STOPPED,
  type Transport,
  type TransportEvent,
  transition,
} from "./transport";

export interface PlayerOptions {
  /** The engine module. */
  readonly wasmUrl: string | URL;
  /** The AudioWorklet script. */
  readonly workletUrl: string | URL;
  /**
   * Where the player's keys arrive: the element that takes focus on a press anywhere in
   * the player, so its shortcuts act on its own keys and on no others.
   */
  readonly keyboard: HTMLElement;
  /** Aborts when the player goes: it then closes its audio and stops its timers. */
  readonly signal: AbortSignal;
  /** The player shows its own buttons for its commands; false when its host shows them. */
  readonly actions?: boolean | undefined;
  /** Receives the player's state for its host whenever it may have changed. */
  readonly onState?: ((state: DnbmPlayerState) => void) | undefined;
}

/** Within this many seconds of a song's start, previous goes to the song before. */
const RESTART_SECONDS = 3;
const DEFAULT_VOLUME = 80;

const ICONS = {
  previous: "M3 3h2v10H3zM13 3v10L6 8z",
  play: "M4 2.5v11L13.5 8z",
  pause: "M3.5 3h3v10h-3zM9.5 3h3v10h-3z",
  stop: "M3.5 3.5h9v9h-9z",
  next: "M11 3h2v10h-2zM3 3v10l7-5z",
  shuffle:
    "M1 4h3l6 8h3v-2l3 3-3 3v-2H9.5l-6-8H1zM10 4h3V2l3 3-3 3V6h-2.5l-1.6 2.1-1.2-1.6zM1 12h2.5l1.6-2.1 1.2 1.6L4 14H1z",
  repeat: "M3 5h8V3l3 3-3 3V7H5v3H3zM13 11H5v2l-3-3 3-3v2h6V6h2z",
};

export class Player {
  readonly element: HTMLElement;
  private readonly timelines: readonly Timeline[];
  private readonly playlist: Playlist;
  private host: EngineHost | undefined;
  private starting: Promise<EngineHost | undefined> | undefined;
  /** The selected song; a paused selection may differ from the engine's loaded song. */
  private current = 0;
  /** The song the engine holds, once one has been sent to it. */
  private loaded: number | undefined;
  /** Stopped, playing or paused, and where the engine is; only `send` changes it. */
  private transport: Transport = STOPPED;
  /** The step playing, counted from the start of the song. */
  private step = 0;
  /** Runs while an ending's wait counts (`counting`), then moves on to the next song. */
  private tailTimer: ReturnType<typeof setTimeout> | undefined;
  private seeking = false;
  private showRemaining = false;

  private readonly time: HTMLButtonElement;
  private readonly title: HTMLElement;
  private readonly titleText: HTMLElement;
  private readonly details: HTMLElement;
  private readonly status: HTMLElement;
  private readonly seek: HTMLInputElement;
  private readonly volume: HTMLInputElement;
  private readonly buttons: Record<keyof typeof ICONS, HTMLButtonElement>;
  private readonly rows: HTMLButtonElement[];
  private readonly spectrum: Spectrum;

  constructor(
    root: HTMLElement,
    private readonly songs: readonly Song[],
    private readonly options: PlayerOptions,
  ) {
    this.spectrum = new Spectrum(options.signal);
    options.signal.addEventListener(
      "abort",
      () => {
        this.send({ type: "elapse" });
        this.host = undefined;
      },
      { once: true },
    );
    this.timelines = songs.map(timeline);
    this.playlist = new Playlist(songs.length);

    const button = (name: keyof typeof ICONS, label: string, shortcut: string) =>
      h(
        "button",
        {
          type: "button",
          class: `control ${name}`,
          "aria-label": label,
          title: `${label} (${shortcut})`,
        },
        [icon(ICONS[name])],
      );
    this.buttons = {
      previous: button("previous", "Previous", "Z"),
      play: button("play", "Play", "X"),
      pause: button("pause", "Pause", "C"),
      stop: button("stop", "Stop", "V"),
      next: button("next", "Next", "B"),
      shuffle: button("shuffle", "Shuffle", "S"),
      repeat: button("repeat", "Repeat", "R"),
    };
    this.buttons.shuffle.setAttribute("aria-pressed", "false");
    this.buttons.repeat.setAttribute("aria-pressed", "false");

    this.time = h("button", {
      type: "button",
      class: "time",
      title: "Show elapsed or remaining time",
    });
    this.titleText = h("span", { class: "title-text" });
    this.title = h("div", { class: "title" }, [this.titleText]);
    this.details = h("div", { class: "details" });
    this.status = h("div", { class: "status", role: "status" });
    this.seek = h("input", {
      type: "range",
      class: "seek",
      min: 0,
      max: 1,
      step: "any",
      value: 0,
      "aria-label": "Position",
    });
    this.volume = h("input", {
      type: "range",
      class: "volume",
      min: 0,
      max: 100,
      step: 1,
      value: DEFAULT_VOLUME,
      "aria-label": "Volume",
    });

    this.rows = songs.map((song, index) =>
      h("button", { type: "button", class: "track", "data-index": index }, [
        h("span", { class: "track-number", text: `${index + 1}.` }),
        h("span", { class: "track-title", text: song.title }),
        h("span", { class: "track-time", text: clock(this.timelines[index]?.seconds ?? 0) }),
      ]),
    );
    const total = this.timelines.reduce((sum, line) => sum + line.seconds, 0);

    this.element = h("div", { class: "player" }, [
      h("section", { class: "main", "aria-label": "Player" }, [
        h("div", { class: "bar" }, [h("span", { class: "wordmark", text: "dnbm player" })]),
        h("div", { class: "display" }, [
          h("div", { class: "readout" }, [this.time, this.spectrum.element]),
          h("div", { class: "info" }, [this.title, this.details]),
        ]),
        this.seek,
        h("div", { class: "controls" }, [
          // The buttons for the player's commands, which a host that shows them itself
          // leaves out.
          ...(options.actions === false
            ? []
            : [
                h("div", { class: "transport" }, [
                  this.buttons.previous,
                  this.buttons.play,
                  this.buttons.pause,
                  this.buttons.stop,
                  this.buttons.next,
                ]),
                h("div", { class: "modes" }, [this.buttons.shuffle, this.buttons.repeat]),
              ]),
          this.volume,
        ]),
        this.status,
      ]),
      h("section", { class: "list", "aria-label": "Playlist" }, [
        h(
          "ol",
          { class: "tracks" },
          this.rows.map((row) => h("li", {}, [row])),
        ),
        h("div", { class: "summary" }, [
          h("span", { text: `${songs.length} ${songs.length === 1 ? "song" : "songs"}` }),
          h("span", { text: clock(total) }),
        ]),
      ]),
    ]);
    root.replaceChildren(this.element);
    this.listen();
    this.volume.style.setProperty("--fill", `${DEFAULT_VOLUME}%`);
    this.render();
  }

  private listen(): void {
    const { buttons } = this;
    buttons.previous.addEventListener("click", () => this.previous());
    buttons.play.addEventListener("click", () => void this.play());
    buttons.pause.addEventListener("click", () => this.pause());
    buttons.stop.addEventListener("click", () => this.stop());
    buttons.next.addEventListener("click", () => this.next());
    buttons.shuffle.addEventListener("click", () => this.toggleShuffle());
    buttons.repeat.addEventListener("click", () => this.toggleRepeat());
    this.time.addEventListener("click", () => {
      this.showRemaining = !this.showRemaining;
      this.render();
    });
    for (const [index, row] of this.rows.entries()) {
      row.addEventListener("click", () => void this.play(index));
    }
    this.seek.addEventListener("input", () => {
      this.seeking = true;
      this.renderTime(Number(this.seek.value));
    });
    this.seek.addEventListener("change", () => {
      this.seeking = false;
      this.seekTo(Number(this.seek.value));
    });
    this.volume.addEventListener("input", () => {
      this.volume.style.setProperty("--fill", `${this.volume.value}%`);
      this.host?.setVolume(this.gain());
    });
    this.options.keyboard.addEventListener("keydown", (event) => this.keydown(event));
  }

  private keydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement) return;
    const actions: Record<string, () => void> = {
      z: () => this.previous(),
      x: () => void this.play(),
      c: () => this.pause(),
      v: () => this.stop(),
      b: () => this.next(),
      s: () => this.toggleShuffle(),
      r: () => this.toggleRepeat(),
      " ": () => (this.mode === "playing" ? this.pause() : void this.play()),
    };
    // Space on a focused button presses it; leave that to the button.
    if (event.key === " " && event.target instanceof HTMLButtonElement) return;
    const action = actions[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    action();
  }

  private get mode(): Transport["status"] {
    return this.transport.status;
  }

  /**
   * Applies a transport event, then runs the ending's timer exactly while its wait counts:
   * leaving the ending, or pausing it, clears the timer.
   */
  private send(event: TransportEvent): void {
    this.transport = transition(this.transport, event);
    const wait = counting(this.transport);
    if (!wait && this.tailTimer !== undefined) {
      clearTimeout(this.tailTimer);
      this.tailTimer = undefined;
    } else if (wait && this.tailTimer === undefined && !this.options.signal.aborted) {
      this.tailTimer = setTimeout(
        () => {
          this.tailTimer = undefined;
          this.send({ type: "elapse" });
          const next = this.playlist.next(this.current);
          if (next === undefined) this.stop();
          else void this.play(next);
        },
        Math.max(0, wait.remaining),
      );
    }
  }

  /** Which of its commands the player takes now: none without songs, or once it goes. */
  private available(): Record<DnbmPlayerCommand, boolean> {
    const free = this.songs.length > 0 && !this.options.signal.aborted;
    return {
      play: free && this.mode !== "playing",
      pause: free && this.mode === "playing",
      togglePlay: free,
      // Stopped after a seek, stop still goes back to the start, as its button does.
      stop: free && (this.mode !== "stopped" || this.step !== 0),
      previous: free,
      next: free,
      toggleShuffle: free,
      toggleRepeat: free,
    };
  }

  /** Tells the host the player's state, which the shell passes on only when it changed. */
  private publish(): void {
    this.options.onState?.({
      playing: this.mode === "playing",
      paused: this.mode === "paused",
      title: this.songs[this.current]?.title ?? "",
      shuffle: this.playlist.shuffle,
      repeat: this.playlist.repeat,
      available: this.available(),
    });
  }

  /**
   * Carries out a command from the host, as its button or shortcut would, if it is
   * available now; returns whether it did.
   */
  run(command: string): boolean {
    const available: Record<string, boolean> = this.available();
    if (!Object.hasOwn(available, command) || available[command] !== true) return false;
    const actions: Record<DnbmPlayerCommand, () => void> = {
      play: () => void this.play(),
      pause: () => this.pause(),
      togglePlay: () => (this.mode === "playing" ? this.pause() : void this.play()),
      stop: () => this.stop(),
      previous: () => this.previous(),
      next: () => this.next(),
      toggleShuffle: () => this.toggleShuffle(),
      toggleRepeat: () => this.toggleRepeat(),
    };
    actions[command as DnbmPlayerCommand]();
    return true;
  }

  /** The volume control's gain: squared, so the control feels even to the ear. */
  private gain(): number {
    return (Number(this.volume.value) / 100) ** 2;
  }

  /** Starts the engine on the first play, which is a user gesture, as browsers require. */
  private engine(): Promise<EngineHost | undefined> {
    const { wasmUrl, workletUrl, signal } = this.options;
    this.starting ??= EngineHost.start(wasmUrl, workletUrl, signal).then(
      (host) => {
        this.host = host;
        // Pause may have arrived before there was a host to suspend. Do not start
        // or briefly resume the queued song when initialization finishes.
        if (this.mode === "paused") void host.context.suspend();
        host.setVolume(this.gain());
        host.onPosition = (position) => this.position(position);
        host.onError = (message) => this.fail(message);
        this.spectrum.attach(host.analyser);
        return host;
      },
      (error: unknown) => {
        if (signal.aborted) return undefined;
        this.starting = undefined;
        this.fail(error instanceof Error ? error.message : String(error));
        return undefined;
      },
    );
    return this.starting;
  }

  /**
   * Plays a song from the start, or resumes: from a pause, or from where a seek left
   * the paused or stopped selection. Without an index, plays the current song.
   */
  async play(index?: number): Promise<void> {
    if (this.songs.length === 0) return;
    if (index === undefined && resumable(this.transport)) {
      this.send({ type: "play" });
      void this.host?.context.resume();
      this.waitForTail();
      this.render();
      return;
    }
    if (index !== undefined) this.current = index;
    // Explicit song selection or play while playing restarts; otherwise keep the queue.
    if (index !== undefined || this.mode === "playing") this.queuePosition(0);
    this.send({ type: "play" });
    this.render();
    const host = await this.engine();
    // The player may have gone while the engine was awaited.
    if (this.options.signal.aborted) return;
    if (!host) {
      this.send({ type: "fail" });
      this.render();
      return;
    }
    // Several play requests can await the same startup; consume the queue once.
    const slot = pendingStart(this.transport);
    if (slot !== undefined) this.start(host, slot);
  }

  /** Tells the engine to play the selected song from `slot`; only while playing. */
  private start(host: EngineHost, slot: number): void {
    if (this.mode !== "playing") return;
    const song = this.songs[this.current];
    if (!song) return;
    if (this.loaded !== this.current) {
      host.loadSong(song);
      this.loaded = this.current;
    }
    this.send({ type: "start", slot });
    this.step = this.timelines[this.current]?.slotSteps[slot] ?? 0;
    host.play(PlayMode.SongOnce, slot);
    this.render();
  }

  /** Pauses, or resumes from a pause. */
  pause(): void {
    if (this.mode === "paused") {
      void this.play();
    } else if (this.mode === "playing") {
      this.send({ type: "pause", now: performance.now() });
      void this.host?.context.suspend();
      this.render();
    }
  }

  stop(): void {
    const paused = this.mode === "paused";
    this.send({ type: "stop" });
    if (paused) void this.host?.context.resume();
    this.host?.stop();
    this.step = 0;
    this.render();
  }

  next(): void {
    const next = this.playlist.next(this.current, true);
    if (next !== undefined) this.skipTo(next);
  }

  previous(): void {
    const elapsed = this.step * (this.timelines[this.current]?.stepSeconds ?? 0);
    if (this.mode !== "stopped" && elapsed > RESTART_SECONDS) {
      this.skipTo(this.current);
      return;
    }
    const previous = this.playlist.previous(this.current, true);
    if (previous !== undefined) this.skipTo(previous);
  }

  /** Moves to a song, playing it if the player is playing. */
  private skipTo(index: number): void {
    if (this.mode !== "playing") {
      this.current = index;
      this.queuePosition(0);
    } else {
      void this.play(index);
    }
  }

  /** Selects a position without resuming audio or accepting the old engine's reports. */
  private queuePosition(slot: number): void {
    this.send({ type: "queue", slot });
    this.step = this.timelines[this.current]?.slotSteps[slot] ?? 0;
    this.render();
  }

  private seekTo(seconds: number): void {
    const line = this.timelines[this.current];
    if (!line) return;
    const slot = slotAt(line, seconds);
    if (this.mode !== "playing" || !this.host) {
      this.queuePosition(slot);
    } else {
      this.start(this.host, slot);
    }
  }

  private toggleShuffle(): void {
    this.playlist.setShuffle(!this.playlist.shuffle, this.current);
    this.render();
  }

  private toggleRepeat(): void {
    this.playlist.repeat = !this.playlist.repeat;
    this.render();
  }

  private position(position: PlayingPosition): void {
    const before = this.transport.engine.phase;
    const { playing, slot, step } = position;
    // The transport drops reports sent before the engine took the last play or seek.
    this.send({ type: "report", playing, slot, step });
    const { phase } = this.transport.engine;
    const line = this.timelines[this.current];
    if (!line) return;
    if (phase === "running") {
      this.step = stepAt(line, slot, step);
    } else if (phase === "ending" && before === "running") {
      this.step = line.steps;
      this.waitForTail();
    } else {
      return;
    }
    this.render();
  }

  /** Lets what is left of an ending ring out while playing, then moves on to the next song. */
  private waitForTail(): void {
    if (this.options.signal.aborted) return;
    this.send({ type: "wait", now: performance.now() });
  }

  private fail(message: string): void {
    setText(this.status, message);
  }

  private render(): void {
    this.publish();
    const song = this.songs[this.current];
    const line = this.timelines[this.current];
    if (!song || !line) {
      setText(this.titleText, "No songs");
      return;
    }
    const titleText = `${this.current + 1}. ${song.title} (${clock(line.seconds)})`;
    if (this.titleText.textContent !== titleText) {
      setText(this.titleText, titleText);
      // Long titles scroll, as on the players this one follows.
      this.title.classList.toggle("scrolling", this.titleText.scrollWidth > this.title.clientWidth);
    }
    const bars = line.steps / STEPS_PER_BAR;
    setText(this.details, `${song.bpm} bpm · ${bars} bars`);
    this.element.dataset["state"] = this.mode;
    this.element.toggleAttribute("data-ending", this.transport.engine.phase === "ending");
    this.buttons.play.setAttribute("aria-pressed", String(this.mode === "playing"));
    this.buttons.pause.setAttribute("aria-pressed", String(this.mode === "paused"));
    this.buttons.shuffle.setAttribute("aria-pressed", String(this.playlist.shuffle));
    this.buttons.repeat.setAttribute("aria-pressed", String(this.playlist.repeat));
    for (const [index, row] of this.rows.entries()) {
      const current = index === this.current;
      row.classList.toggle("current", current);
      if (current) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    }
    this.seek.max = String(line.seconds);
    if (!this.seeking) this.renderTime(this.step * line.stepSeconds);
  }

  private renderTime(seconds: number): void {
    const line = this.timelines[this.current];
    if (!line) return;
    if (!this.seeking) this.seek.value = String(seconds);
    this.seek.style.setProperty("--fill", `${(seconds / line.seconds) * 100}%`);
    setText(this.time, this.showRemaining ? `-${clock(line.seconds - seconds)}` : clock(seconds));
    this.time.setAttribute(
      "aria-label",
      `${this.showRemaining ? "Remaining" : "Elapsed"} ${clock(this.showRemaining ? line.seconds - seconds : seconds)}`,
    );
  }
}
