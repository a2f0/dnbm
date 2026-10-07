// The player: a playlist of songs, a display and transport controls in the spirit of
// a classic desktop music player, all driving the same engine as the sequencer. It
// edits nothing; it only plays the songs it is given.

import { EngineHost, type PlayingPosition } from "@a2f0/dnbm-synth/audio/engineHost";
import { PlayMode } from "@a2f0/dnbm-synth/audio/wasmEngine";
import type { Song } from "@a2f0/dnbm-synth/song/model";
import { STEPS_PER_BAR } from "@a2f0/dnbm-synth/song/notation";
import { h, icon, setText } from "./dom";
import { Playlist } from "./playlist";
import { Spectrum } from "./spectrum";
import { clock, slotAt, stepAt, type Timeline, timeline } from "./timeline";

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
}

type State = "stopped" | "playing" | "paused";

/** How long a finished song rings out before the next one starts. */
const TAIL_MS = 1500;
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
  /** The song shown on the display, and playing unless stopped. */
  private current = 0;
  /** The song the engine holds, once one has been sent to it. */
  private loaded: number | undefined;
  private state: State = "stopped";
  /** The step playing, counted from the start of the song. */
  private step = 0;
  /** After a play or seek, positions are stale until the engine reports this slot's first step. */
  private awaitingSlot: number | undefined;
  /** Where play starts from when stopped, after a seek while stopped. */
  private startSlot = 0;
  /** Whether the engine was told to play the current song since it last stopped. */
  private started = false;
  /**
   * After a song ends, while its reverb and delay ring out before the next starts. The
   * wait holds while paused, so it keeps what is left of it.
   */
  private tail:
    | { remaining: number; since: number; timer: ReturnType<typeof setTimeout> | undefined }
    | undefined;
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
        this.clearTail();
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
          h("div", { class: "transport" }, [
            this.buttons.previous,
            this.buttons.play,
            this.buttons.pause,
            this.buttons.stop,
            this.buttons.next,
          ]),
          h("div", { class: "modes" }, [this.buttons.shuffle, this.buttons.repeat]),
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
      " ": () => (this.state === "playing" ? this.pause() : void this.play()),
    };
    // Space on a focused button presses it; leave that to the button.
    if (event.key === " " && event.target instanceof HTMLButtonElement) return;
    const action = actions[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    action();
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
   * the stopped song. Without an index, plays the current song.
   */
  async play(index?: number): Promise<void> {
    if (this.songs.length === 0) return;
    if (index === undefined && this.state === "paused" && (this.started || this.tail)) {
      this.state = "playing";
      void this.host?.context.resume();
      this.waitForTail();
      this.render();
      return;
    }
    if (index !== undefined) this.current = index;
    // A seek while stopped sets where play starts; anything else starts the song over.
    if (index !== undefined || this.state === "playing") this.startSlot = 0;
    this.state = "playing";
    this.render();
    const host = await this.engine();
    // The player may have gone while the engine was awaited.
    if (this.options.signal.aborted) return;
    if (!host) {
      this.state = "stopped";
      this.render();
    } else if (this.state === "playing") {
      this.start(host, this.startSlot);
    }
  }

  private start(host: EngineHost, slot: number): void {
    this.clearTail();
    const song = this.songs[this.current];
    if (!song) return;
    if (this.loaded !== this.current) {
      host.loadSong(song);
      this.loaded = this.current;
    }
    this.awaitingSlot = slot;
    this.step = this.timelines[this.current]?.slotSteps[slot] ?? 0;
    this.started = true;
    host.play(PlayMode.SongOnce, slot);
    this.startSlot = 0;
    this.render();
  }

  /** Pauses, or resumes from a pause. */
  pause(): void {
    if (this.state === "paused") {
      void this.play();
    } else if (this.state === "playing") {
      this.state = "paused";
      void this.host?.context.suspend();
      if (this.tail?.timer !== undefined) {
        clearTimeout(this.tail.timer);
        this.tail.timer = undefined;
        this.tail.remaining -= performance.now() - this.tail.since;
      }
      this.render();
    }
  }

  stop(): void {
    this.clearTail();
    this.started = false;
    if (this.state === "paused") void this.host?.context.resume();
    this.host?.stop();
    this.state = "stopped";
    this.step = 0;
    this.startSlot = 0;
    this.awaitingSlot = undefined;
    this.render();
  }

  next(): void {
    const next = this.playlist.next(this.current, true);
    if (next !== undefined) this.skipTo(next);
  }

  previous(): void {
    const elapsed = this.step * (this.timelines[this.current]?.stepSeconds ?? 0);
    if (this.state !== "stopped" && elapsed > RESTART_SECONDS) {
      this.skipTo(this.current);
      return;
    }
    const previous = this.playlist.previous(this.current, true);
    if (previous !== undefined) this.skipTo(previous);
  }

  /** Moves to a song, playing it if the player is playing. */
  private skipTo(index: number): void {
    if (this.state === "stopped") {
      this.current = index;
      this.step = 0;
      this.startSlot = 0;
      this.render();
    } else {
      void this.play(index);
    }
  }

  private seekTo(seconds: number): void {
    const line = this.timelines[this.current];
    if (!line) return;
    const slot = slotAt(line, seconds);
    if (this.state === "stopped") {
      this.startSlot = slot;
      this.step = line.slotSteps[slot] ?? 0;
      this.render();
    } else if (this.host) {
      this.state = "playing";
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
    if (!this.started) return;
    // Reports sent before the engine took the last play or seek are stale.
    if (this.awaitingSlot !== undefined) {
      if (!position.playing || position.slot !== this.awaitingSlot || position.step !== 0) return;
      this.awaitingSlot = undefined;
    }
    const line = this.timelines[this.current];
    if (!line) return;
    if (position.playing) {
      this.step = stepAt(line, position.slot, position.step);
    } else {
      // The engine plays a song once, and stopped as its last step ended.
      this.started = false;
      this.step = line.steps;
      this.tail = { remaining: TAIL_MS, since: 0, timer: undefined };
      if (this.state === "playing") this.waitForTail();
    }
    this.render();
  }

  /** Lets what is left of the tail ring out, then moves on to the next song. */
  private waitForTail(): void {
    const tail = this.tail;
    if (!tail || tail.timer !== undefined || this.options.signal.aborted) return;
    tail.since = performance.now();
    tail.timer = setTimeout(
      () => {
        this.tail = undefined;
        const next = this.playlist.next(this.current);
        if (next === undefined) this.stop();
        else void this.play(next);
      },
      Math.max(0, tail.remaining),
    );
  }

  private clearTail(): void {
    clearTimeout(this.tail?.timer);
    this.tail = undefined;
  }

  private fail(message: string): void {
    setText(this.status, message);
  }

  private render(): void {
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
    this.element.dataset["state"] = this.state;
    this.element.toggleAttribute("data-ending", this.tail !== undefined);
    this.buttons.play.setAttribute("aria-pressed", String(this.state === "playing"));
    this.buttons.pause.setAttribute("aria-pressed", String(this.state === "paused"));
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
