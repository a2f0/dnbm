// A bar spectrum of the output with falling peak caps, drawn in the page's greys.

const BARS = 20;
const LOW_HZ = 40;
const HIGH_HZ = 16_000;
/** How far a peak cap falls per frame, as a fraction of the height. */
const PEAK_FALL = 0.012;

export class Spectrum {
  readonly element: HTMLCanvasElement;
  private analyser: AnalyserNode | undefined;
  private bins: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private readonly levels = new Float32Array(BARS);
  private readonly peaks = new Float32Array(BARS);
  private frame: number | undefined;

  /** Draws until `signal` aborts. */
  constructor(signal: AbortSignal) {
    this.element = Object.assign(document.createElement("canvas"), { className: "spectrum" });
    this.element.setAttribute("aria-hidden", "true");
    if (signal.aborted) return;
    this.frame = requestAnimationFrame(() => this.draw());
    signal.addEventListener(
      "abort",
      () => {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
        this.analyser = undefined;
      },
      { once: true },
    );
  }

  attach(analyser: AnalyserNode): void {
    analyser.smoothingTimeConstant = 0.7;
    this.analyser = analyser;
    this.bins = new Uint8Array(analyser.frequencyBinCount);
  }

  /** Each bar's level from 0 to 1: the loudest bin in its band, bands spaced by octave. */
  private measure(): void {
    const { analyser, bins, levels } = this;
    if (!analyser) return;
    analyser.getByteFrequencyData(bins);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    for (let bar = 0; bar < BARS; bar++) {
      const from = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (bar / BARS);
      const to = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((bar + 1) / BARS);
      const first = Math.floor(from / binHz);
      const last = Math.max(first, Math.ceil(to / binHz) - 1);
      let loudest = 0;
      for (let bin = first; bin <= last && bin < bins.length; bin++) {
        loudest = Math.max(loudest, bins[bin] ?? 0);
      }
      levels[bar] = loudest / 255;
    }
  }

  private draw(): void {
    this.frame = requestAnimationFrame(() => this.draw());
    const { element, levels, peaks } = this;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(element.clientWidth * ratio);
    const height = Math.round(element.clientHeight * ratio);
    if (width === 0 || height === 0) return;
    if (element.width !== width || element.height !== height) {
      element.width = width;
      element.height = height;
    }
    const context = element.getContext("2d");
    if (!context) return;
    this.measure();
    const style = getComputedStyle(element);
    context.clearRect(0, 0, width, height);
    const gap = Math.max(1, Math.round(ratio));
    const barWidth = (width - gap * (BARS - 1)) / BARS;
    const cap = Math.max(1, Math.round(1.5 * ratio));
    for (let bar = 0; bar < BARS; bar++) {
      const level = levels[bar] ?? 0;
      const peak = Math.max(level, (peaks[bar] ?? 0) - PEAK_FALL);
      peaks[bar] = peak;
      const x = Math.round(bar * (barWidth + gap));
      const w = Math.round(barWidth);
      const top = Math.round((1 - level) * height);
      context.fillStyle = style.getPropertyValue("--spectrum-bar");
      context.fillRect(x, top, w, height - top);
      context.fillStyle = style.getPropertyValue("--spectrum-peak");
      context.fillRect(x, Math.min(height - cap, Math.round((1 - peak) * height)), w, cap);
    }
  }
}
