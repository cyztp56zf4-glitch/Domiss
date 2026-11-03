import type { Clip, Range } from "../types";

/** Clips shorter than this are dropped after an edit (avoids invisible slivers). */
export const MIN_CLIP = 0.05;

let counter = 0;
export function uid(prefix = "c"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const clipLength = (c: Clip) => c.out - c.in;

export function timelineDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + clipLength(c), 0);
}

/** Timeline start time of each clip. */
export function clipStarts(clips: Clip[]): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const c of clips) {
    starts.push(t);
    t += clipLength(c);
  }
  return starts;
}

export interface Location {
  index: number;
  clip: Clip;
  offset: number; // seconds into the clip
  sourceTime: number;
}

/** Find which clip plays at timeline time `t`. Returns null past the end. */
export function locate(clips: Clip[], t: number): Location | null {
  let start = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const len = clipLength(c);
    if (t < start + len || (i === clips.length - 1 && t <= start + len)) {
      const offset = Math.max(0, t - start);
      return { index: i, clip: c, offset, sourceTime: c.in + offset };
    }
    start += len;
  }
  return null;
}

/** Map a source time to the first timeline time where it is played, or null if it was cut. */
export function sourceToTimeline(clips: Clip[], mediaId: string, s: number): number | null {
  let start = 0;
  for (const c of clips) {
    if (c.mediaId === mediaId && s >= c.in && s < c.out) return start + (s - c.in);
    start += clipLength(c);
  }
  return null;
}

/** True if any part of [s, e) of the source is on the timeline. */
export function isSourceUsed(clips: Clip[], mediaId: string, s: number, e: number): boolean {
  return clips.some((c) => c.mediaId === mediaId && c.in < e && c.out > s);
}

export function splitAt(clips: Clip[], t: number): Clip[] {
  const loc = locate(clips, t);
  if (!loc) return clips;
  const { clip, sourceTime, index } = loc;
  if (sourceTime - clip.in < MIN_CLIP || clip.out - sourceTime < MIN_CLIP) return clips;
  const a: Clip = { ...clip, id: uid(), out: sourceTime };
  const b: Clip = { ...clip, id: uid(), in: sourceTime };
  return [...clips.slice(0, index), a, b, ...clips.slice(index + 1)];
}

/** Remove a span of the *timeline* (ripple delete). */
export function removeTimelineRange(clips: Clip[], start: number, end: number): Clip[] {
  if (end <= start) return clips;
  const out: Clip[] = [];
  let t = 0;
  for (const c of clips) {
    const len = clipLength(c);
    const cs = t;
    const ce = t + len;
    t = ce;
    if (ce <= start || cs >= end) {
      out.push(c);
      continue;
    }
    // part before the removed span
    if (cs < start) out.push({ ...c, id: uid(), out: c.in + (start - cs) });
    // part after the removed span
    if (ce > end) out.push({ ...c, id: uid(), in: c.in + (end - cs) });
  }
  return out.filter((c) => clipLength(c) >= MIN_CLIP);
}

/** Cut the given *source* ranges of one media out of every clip that uses it. */
export function removeSourceRanges(clips: Clip[], mediaId: string, ranges: Range[]): Clip[] {
  const cuts = mergeRanges(ranges);
  if (!cuts.length) return clips;
  const out: Clip[] = [];
  for (const c of clips) {
    if (c.mediaId !== mediaId) {
      out.push(c);
      continue;
    }
    let pieces: Clip[] = [c];
    for (const r of cuts) {
      const next: Clip[] = [];
      for (const p of pieces) {
        if (r.end <= p.in || r.start >= p.out) {
          next.push(p);
          continue;
        }
        if (r.start > p.in) next.push({ ...p, id: uid(), out: r.start });
        if (r.end < p.out) next.push({ ...p, id: uid(), in: r.end });
      }
      pieces = next;
    }
    // keep original id when nothing changed
    if (pieces.length === 1 && pieces[0].in === c.in && pieces[0].out === c.out) out.push(c);
    else out.push(...pieces);
  }
  return out.filter((c) => clipLength(c) >= MIN_CLIP);
}

/** Build a fresh timeline that plays only `ranges` of a media, in the order given. */
export function clipsFromRanges(mediaId: string, ranges: Range[]): Clip[] {
  return ranges
    .filter((r) => r.end - r.start >= MIN_CLIP)
    .map((r) => ({ id: uid(), mediaId, in: r.start, out: r.end }));
}

export function trimClip(
  clips: Clip[],
  id: string,
  edge: "in" | "out",
  value: number,
  mediaDuration: number,
): Clip[] {
  return clips.map((c) => {
    if (c.id !== id) return c;
    if (edge === "in") return { ...c, in: clamp(value, 0, c.out - MIN_CLIP) };
    return { ...c, out: clamp(value, c.in + MIN_CLIP, mediaDuration) };
  });
}

export function moveClip(clips: Clip[], from: number, to: number): Clip[] {
  if (from === to || from < 0 || from >= clips.length) return clips;
  const next = clips.slice();
  const [c] = next.splice(from, 1);
  next.splice(clamp(to, 0, next.length), 0, c);
  return next;
}

export function mergeRanges(ranges: Range[], gap = 0): Range[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .map((r) => ({ ...r }))
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + gap) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/** Complement of `ranges` within [0, duration]. */
export function invertRanges(ranges: Range[], duration: number): Range[] {
  const merged = mergeRanges(ranges);
  const out: Range[] = [];
  let t = 0;
  for (const r of merged) {
    if (r.start > t) out.push({ start: t, end: Math.min(r.start, duration) });
    t = Math.max(t, r.end);
  }
  if (t < duration) out.push({ start: t, end: duration });
  return out.filter((r) => r.end - r.start > 0);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function formatTime(t: number, withMs = true): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const base = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  if (!withMs) return base;
  const ds = Math.floor((t % 1) * 10);
  return `${base}.${ds}`;
}

/** Join neighbouring clips that play one continuous stretch of the same source. */
export function mergeAdjacent(clips: Clip[], tolerance = 0.001): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    const last = out[out.length - 1];
    if (last && last.mediaId === c.mediaId && Math.abs(last.out - c.in) <= tolerance) {
      out[out.length - 1] = { ...last, out: c.out };
    } else out.push(c);
  }
  return out;
}

/**
 * Put a previously cut source range back on the timeline, next to the clips that
 * surround it in the source (used by "restore" in the transcript editor).
 */
export function restoreSourceRange(clips: Clip[], mediaId: string, range: Range): Clip[] {
  if (range.end - range.start < MIN_CLIP) return clips;
  const base = removeSourceRanges(clips, mediaId, [range]);
  let at = base.findIndex((c) => c.mediaId === mediaId && c.in >= range.end);
  if (at === -1) {
    let lastBefore = -1;
    base.forEach((c, i) => {
      if (c.mediaId === mediaId && c.out <= range.start) lastBefore = i;
    });
    at = lastBefore === -1 ? base.length : lastBefore + 1;
  }
  const clip: Clip = { id: uid(), mediaId, in: range.start, out: range.end };
  return mergeAdjacent([...base.slice(0, at), clip, ...base.slice(at)]);
}
