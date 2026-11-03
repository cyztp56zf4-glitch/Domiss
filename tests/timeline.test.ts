import { describe, expect, it } from "vitest";
import type { Clip } from "../src/types";
import {
  invertRanges,
  locate,
  mergeAdjacent,
  mergeRanges,
  moveClip,
  removeSourceRanges,
  removeTimelineRange,
  restoreSourceRange,
  sourceToTimeline,
  splitAt,
  timelineDuration,
} from "../src/lib/timeline";

const strip = (cs: Clip[]) => cs.map(({ mediaId, in: i, out }) => [mediaId, +i.toFixed(3), +out.toFixed(3)]);
const base: Clip[] = [
  { id: "a", mediaId: "m1", in: 0, out: 10 },
  { id: "b", mediaId: "m2", in: 5, out: 8 },
];

describe("timeline", () => {
  it("locates timeline time across clips", () => {
    expect(locate(base, 3)).toMatchObject({ index: 0, sourceTime: 3 });
    expect(locate(base, 11)).toMatchObject({ index: 1, sourceTime: 6 });
    expect(locate(base, 13)).toMatchObject({ index: 1, sourceTime: 8 });
    expect(locate(base, 14)).toBeNull();
  });

  it("maps source to timeline", () => {
    expect(sourceToTimeline(base, "m2", 6)).toBe(11);
    expect(sourceToTimeline(base, "m2", 1)).toBeNull();
  });

  it("splits at the playhead", () => {
    expect(strip(splitAt(base, 4))).toEqual([["m1", 0, 4], ["m1", 4, 10], ["m2", 5, 8]]);
    expect(splitAt(base, 0)).toBe(base);
  });

  it("ripple-deletes a timeline range spanning clips", () => {
    expect(strip(removeTimelineRange(base, 8, 11))).toEqual([["m1", 0, 8], ["m2", 6, 8]]);
  });

  it("removes source ranges of one media only", () => {
    const out = removeSourceRanges(base, "m1", [{ start: 2, end: 3 }, { start: 2.5, end: 4 }, { start: 9.99, end: 12 }]);
    expect(strip(out)).toEqual([["m1", 0, 2], ["m1", 4, 9.99], ["m2", 5, 8]]);
    expect(timelineDuration(out)).toBeCloseTo(10.99);
  });

  it("restores a cut range in source order and merges it back", () => {
    const cut = removeSourceRanges(base, "m1", [{ start: 2, end: 4 }]);
    const restored = restoreSourceRange(cut, "m1", { start: 2, end: 4 });
    expect(strip(restored)).toEqual([["m1", 0, 10], ["m2", 5, 8]]);
  });

  it("moves clips", () => {
    expect(moveClip(base, 0, 1).map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("merges and inverts ranges", () => {
    expect(mergeRanges([{ start: 5, end: 6 }, { start: 1, end: 3 }, { start: 2, end: 4 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 6 },
    ]);
    expect(invertRanges([{ start: 1, end: 2 }], 5)).toEqual([{ start: 0, end: 1 }, { start: 2, end: 5 }]);
  });

  it("merges adjacent clips of the same source", () => {
    const cs: Clip[] = [
      { id: "1", mediaId: "m", in: 0, out: 2 },
      { id: "2", mediaId: "m", in: 2, out: 3 },
      { id: "3", mediaId: "m", in: 4, out: 5 },
    ];
    expect(strip(mergeAdjacent(cs))).toEqual([["m", 0, 3], ["m", 4, 5]]);
  });
});
