// The order songs play in. In order by default; shuffled, every song plays once before
// any repeats. Repeat wraps at the end of the order instead of stopping there.

export class Playlist {
  shuffle = false;
  repeat = false;
  private order: number[];

  constructor(
    readonly length: number,
    private readonly random: () => number = Math.random,
  ) {
    this.order = [...Array(length).keys()];
  }

  /** Turns shuffle on or off, keeping `current` where the new order starts. */
  setShuffle(shuffle: boolean, current: number): void {
    this.shuffle = shuffle;
    const rest = [...Array(this.length).keys()].filter((index) => index !== current);
    if (shuffle) {
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j] as number, rest[i] as number];
      }
      this.order = [current, ...rest];
    } else {
      this.order = [...Array(this.length).keys()];
    }
  }

  /**
   * The song after `current`, or undefined past the end of the order unless it wraps:
   * when repeating, or when asked to, as the next and previous buttons do.
   */
  next(current: number, wrap = this.repeat): number | undefined {
    return this.step(current, 1, wrap);
  }

  /** The song before `current`, wrapping as `next` does. */
  previous(current: number, wrap = this.repeat): number | undefined {
    return this.step(current, -1, wrap);
  }

  private step(current: number, by: number, wrap: boolean): number | undefined {
    if (this.length === 0) return undefined;
    const at = this.order.indexOf(current) + by;
    if (at >= 0 && at < this.length) return this.order[at];
    return wrap ? this.order[(at + this.length) % this.length] : undefined;
  }
}
