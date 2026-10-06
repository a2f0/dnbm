// An oscilloscope of the master output, drawn in the page's greys.

export class Scope {
  readonly element: HTMLCanvasElement;
  private analyser: AnalyserNode | undefined;
  private samples: Float32Array<ArrayBuffer> = new Float32Array(0);

  constructor() {
    this.element = Object.assign(document.createElement("canvas"), { className: "scope" });
    this.element.setAttribute("aria-hidden", "true");
  }

  attach(analyser: AnalyserNode): void {
    this.analyser = analyser;
    this.samples = new Float32Array(analyser.fftSize);
    requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    const { analyser, element } = this;
    if (!analyser) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(element.clientWidth * ratio);
    const height = Math.round(element.clientHeight * ratio);
    if (element.width !== width || element.height !== height) {
      element.width = width;
      element.height = height;
    }
    const context = element.getContext("2d");
    if (context && width > 0) {
      const style = getComputedStyle(element);
      analyser.getFloatTimeDomainData(this.samples);
      context.clearRect(0, 0, width, height);
      context.strokeStyle = style.getPropertyValue("--scope-axis");
      context.lineWidth = ratio;
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();
      context.strokeStyle = style.getPropertyValue("--scope-line");
      context.lineWidth = 1.25 * ratio;
      context.beginPath();
      const count = this.samples.length;
      for (let i = 0; i < count; i++) {
        const x = (i / (count - 1)) * width;
        const y = (0.5 - (this.samples[i] ?? 0) * 0.45) * height;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
    requestAnimationFrame(() => this.draw());
  }
}
