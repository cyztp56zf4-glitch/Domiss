import type { Range } from "../types";

/** Decode a media file's audio track to mono Float32 PCM at `sampleRate`. */
export async function decodeAudio(file: File, sampleRate = 16000): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(buf);
  } finally {
    void ctx.close();
  }
  const length = Math.ceil(decoded.duration * sampleRate);
  const offline = new OfflineAudioContext(1, Math.max(1, length), sampleRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination); // downmixes to mono
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

export interface SilenceOptions {
  /** Level below which audio counts as silent, in dBFS (e.g. -40). */
  thresholdDb: number;
  /** Only silences at least this long are reported (seconds). */
  minSilence: number;
  /** Keep this much audio on each side of a cut so speech isn't clipped (seconds). */
  padding: number;
  /** Analysis window (seconds). */
  window?: number;
}

/** Find silent stretches using windowed RMS. Returned ranges are already shrunk by `padding`. */
export function detectSilence(
  pcm: Float32Array,
  sampleRate: number,
  opts: SilenceOptions,
): Range[] {
  const win = Math.max(1, Math.round((opts.window ?? 0.02) * sampleRate));
  const threshold = Math.pow(10, opts.thresholdDb / 20);
  const ranges: Range[] = [];
  let silentFrom: number | null = null;
  const frames = Math.ceil(pcm.length / win);
  for (let f = 0; f < frames; f++) {
    const a = f * win;
    const b = Math.min(pcm.length, a + win);
    let sum = 0;
    for (let i = a; i < b; i++) sum += pcm[i] * pcm[i];
    const rms = Math.sqrt(sum / Math.max(1, b - a));
    const t = a / sampleRate;
    if (rms < threshold) {
      if (silentFrom === null) silentFrom = t;
    } else if (silentFrom !== null) {
      push(silentFrom, t);
      silentFrom = null;
    }
  }
  if (silentFrom !== null) push(silentFrom, pcm.length / sampleRate, true);
  return ranges;

  function push(s: number, e: number, atEnd = false) {
    if (e - s < opts.minSilence) return;
    // no padding needed at the very start/end of the file
    const start = s <= 0 ? 0 : s + opts.padding;
    const end = atEnd ? e : e - opts.padding;
    if (end - start > 0.01) ranges.push({ start, end });
  }
}

/** Downsample PCM into peak values for drawing a waveform. */
export function peaks(pcm: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const size = pcm.length / buckets;
  for (let i = 0; i < buckets; i++) {
    const a = Math.floor(i * size);
    const b = Math.min(pcm.length, Math.floor((i + 1) * size));
    let m = 0;
    for (let j = a; j < b; j++) {
      const v = Math.abs(pcm[j]);
      if (v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}
