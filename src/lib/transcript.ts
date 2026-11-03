import type { Caption, Clip, Range, Segment, Word } from "../types";
import { clipStarts } from "./timeline";

/** Czech + English filler words / hesitations. Matched on the normalized word. */
export const DEFAULT_FILLERS = [
  "ehm", "hm", "hmm", "eh", "ee", "eee", "eeh", "em", "emm", "mm", "mhm", "ááá", "aaa", "eé",
  "um", "uh", "uhm", "erm", "ah",
  "jako", "vlastně", "prostě", "jakoby", "takže jako",
];

export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[.,!?…:;"„“'()\-–]/g, "").trim();
}

/**
 * Group words into segments: break on sentence punctuation, on pauses longer than
 * `maxGap`, or when a segment grows past `maxWords`.
 */
export function buildSegments(
  mediaId: string,
  words: Word[],
  opts: { maxGap?: number; maxWords?: number; startIndex?: number } = {},
): Segment[] {
  const maxGap = opts.maxGap ?? 0.8;
  const maxWords = opts.maxWords ?? 18;
  const segments: Segment[] = [];
  let from = 0;
  const flush = (to: number) => {
    if (to <= from) return;
    const slice = words.slice(from, to);
    segments.push({
      index: (opts.startIndex ?? 0) + segments.length,
      mediaId,
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      text: slice.map((w) => w.text.trim()).join(" ").replace(/\s+([.,!?…])/g, "$1"),
      wordFrom: from,
      wordTo: to,
    });
    from = to;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const endsSentence = /[.!?…]$/.test(w.text.trim());
    const longPause = next ? next.start - w.end > maxGap : false;
    if (endsSentence || longPause || i + 1 - from >= maxWords) flush(i + 1);
  }
  flush(words.length);
  return segments;
}

/** Source ranges covered by filler words (padded slightly so cuts don't clip neighbours). */
export function findFillerRanges(words: Word[], fillers: string[] = DEFAULT_FILLERS): Range[] {
  const set = new Set(fillers.map(normalizeWord));
  const ranges: Range[] = [];
  for (let i = 0; i < words.length; i++) {
    const n = normalizeWord(words[i].text);
    const pair = i + 1 < words.length ? `${n} ${normalizeWord(words[i + 1].text)}` : "";
    if (pair && set.has(pair)) {
      ranges.push({ start: words[i].start, end: words[i + 1].end });
      i++;
    } else if (n && set.has(n)) {
      ranges.push({ start: words[i].start, end: words[i].end });
    }
  }
  return ranges;
}

/**
 * Turn per-media word lists into timeline captions that follow the current edit:
 * only words whose midpoint survives in a clip are kept, re-timed to the timeline.
 */
export function buildCaptions(
  clips: Clip[],
  wordsByMedia: Record<string, Word[]>,
  opts: { maxChars?: number; maxDuration?: number } = {},
): Caption[] {
  const maxChars = opts.maxChars ?? 42;
  const maxDuration = opts.maxDuration ?? 4;
  const starts = clipStarts(clips);
  const timed: Word[] = [];
  clips.forEach((c, i) => {
    for (const w of wordsByMedia[c.mediaId] ?? []) {
      const mid = (w.start + w.end) / 2;
      if (mid < c.in || mid >= c.out) continue;
      timed.push({
        text: w.text.trim(),
        start: starts[i] + Math.max(0, w.start - c.in),
        end: starts[i] + Math.min(c.out, w.end) - c.in,
      });
    }
  });

  const captions: Caption[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    captions.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(" ").replace(/\s+([.,!?…])/g, "$1"),
    });
    cur = [];
  };
  for (const w of timed) {
    const text = [...cur, w].map((x) => x.text).join(" ");
    const tooLong = text.length > maxChars;
    const tooSlow = cur.length > 0 && w.end - cur[0].start > maxDuration;
    const gap = cur.length > 0 && w.start - cur[cur.length - 1].end > 1;
    if (tooLong || tooSlow || gap) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return captions;
}

function stamp(t: number, sep: "," | "."): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => n.toString().padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

export function toSRT(captions: Caption[]): string {
  return captions
    .map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`)
    .join("\n");
}

export function toVTT(captions: Caption[]): string {
  return (
    "WEBVTT\n\n" +
    captions.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n")
  );
}
