import type { CutPlan, HighlightPlan, MetadataPlan } from "../../server/ai";
import type { Range, Segment } from "../types";

export type { CutPlan, HighlightPlan, MetadataPlan };

type Mode = "cut" | "highlights" | "metadata";
type PlanFor<M extends Mode> = M extends "cut" ? CutPlan : M extends "highlights" ? HighlightPlan : MetadataPlan;

export async function requestPlan<M extends Mode>(
  mode: M,
  segments: { i: number; start: number; end: number; text: string }[],
  opts: { instruction?: string; targetSeconds?: number; language?: string } = {},
): Promise<PlanFor<M>> {
  const res = await fetch("/api/ai/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, segments, ...opts }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server vrátil ${res.status}`);
  return body.plan as PlanFor<M>;
}

export async function aiStatus(): Promise<{ ok: boolean; model: string; aiConfigured: boolean } | null> {
  try {
    const res = await fetch("/api/health");
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Convert an inclusive segment-index range into a source time range. */
export function segmentSpan(segments: Segment[], from: number, to: number): Range | null {
  const byIndex = new Map(segments.map((s) => [s.index, s]));
  const a = byIndex.get(from);
  const b = byIndex.get(to);
  if (!a || !b) return null;
  return { start: a.start, end: b.end };
}

/**
 * Pad a speech range a little so cuts don't clip the first/last syllable,
 * without spilling into the neighbouring segments.
 */
export function padSpan(segments: Segment[], r: Range, pad = 0.15, duration = Infinity): Range {
  const prevEnd = Math.max(0, ...segments.filter((s) => s.end <= r.start).map((s) => s.end));
  const nextStart = Math.min(duration, ...segments.filter((s) => s.start >= r.end).map((s) => s.start));
  return {
    start: Math.max(prevEnd, r.start - pad, 0),
    end: Math.min(nextStart, r.end + pad, duration),
  };
}
