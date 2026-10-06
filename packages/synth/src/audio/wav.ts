// Encodes stereo audio as a 24-bit PCM WAV file.

const BYTES_PER_SAMPLE = 3;
const FULL_SCALE = 8_388_607;

export function encodeWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Uint8Array<ArrayBuffer> {
  const frames = left.length;
  const channels = 2;
  const dataBytes = frames * channels * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * BYTES_PER_SAMPLE, true);
  view.setUint16(32, channels * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of [left, right]) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      const value = Math.round(sample * FULL_SCALE);
      bytes[offset] = value & 0xff;
      bytes[offset + 1] = (value >> 8) & 0xff;
      bytes[offset + 2] = (value >> 16) & 0xff;
      offset += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
}
