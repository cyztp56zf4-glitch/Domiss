import { describe, expect, it } from "vitest";
import type { Word } from "../src/types";
import { buildCaptions, buildSegments, findFillerRanges, toSRT } from "../src/lib/transcript";
import { detectSilence } from "../src/lib/audio";
import { buildExportArgs } from "../src/lib/ffmpeg";

const words: Word[] = [
  { text: "Ahoj,", start: 0, end: 0.4 },
  { text: "ehm", start: 0.5, end: 0.9 },
  { text: "dneska", start: 1.0, end: 1.4 },
  { text: "vařím.", start: 1.5, end: 2.0 },
  { text: "Jako", start: 4.0, end: 4.3 },
  { text: "fakt.", start: 4.4, end: 4.8 },
];

describe("transcript", () => {
  it("segments on sentence ends and pauses", () => {
    const segs = buildSegments("m", words, { startIndex: 10 });
    expect(segs.map((s) => [s.index, s.text])).toEqual([
      [10, "Ahoj, ehm dneska vařím."],
      [11, "Jako fakt."],
    ]);
  });

  it("finds filler words case-insensitively", () => {
    expect(findFillerRanges(words, ["ehm", "jako"])).toEqual([
      { start: 0.5, end: 0.9 },
      { start: 4.0, end: 4.3 },
    ]);
  });

  it("captions follow the edit", () => {
    const caps = buildCaptions([{ id: "c", mediaId: "m", in: 1, out: 5 }], { m: words });
    expect(caps[0]).toMatchObject({ text: "dneska vařím.", start: 0 });
    expect(caps[1].start).toBeCloseTo(3);
    expect(toSRT(caps)).toContain("00:00:00,000 --> 00:00:01,000");
  });
});

describe("silence detection", () => {
  it("finds a silent gap with padding", () => {
    const rate = 1000;
    const pcm = new Float32Array(rate * 3);
    for (let i = 0; i < pcm.length; i++) {
      const t = i / rate;
      pcm[i] = t < 1 || t >= 2 ? Math.sin(i) * 0.5 : 0;
    }
    const r = detectSilence(pcm, rate, { thresholdDb: -40, minSilence: 0.5, padding: 0.1, window: 0.01 });
    expect(r).toHaveLength(1);
    expect(r[0].start).toBeCloseTo(1.1, 1);
    expect(r[0].end).toBeCloseTo(1.9, 1);
  });
});

describe("export args", () => {
  it("builds a concat filter graph with one input per clip", () => {
    const media = {
      m: { id: "m", name: "a.mp4", url: "", file: null as unknown as File, duration: 10, width: 1280, height: 720 },
    };
    const args = buildExportArgs(
      [
        { id: "1", mediaId: "m", in: 1, out: 2 },
        { id: "2", mediaId: "m", in: 5, out: 7.5 },
      ],
      media,
      () => "/input/a.mp4",
      { format: "vertical", quality: "fast" },
    );
    expect(args.slice(0, 6)).toEqual(["-ss", "1.000", "-t", "1.000", "-i", "/input/a.mp4"]);
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("concat=n=2:v=1:a=1[vout][aout]");
    expect(graph).toContain("crop=1080:1920");
  });
});
