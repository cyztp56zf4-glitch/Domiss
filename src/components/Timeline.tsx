import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip } from "../types";
import type { MediaEntry } from "../store";
import { clipLength, clipStarts, formatTime, moveClip, timelineDuration, trimClip } from "../lib/timeline";

interface Props {
  clips: Clip[];
  media: Record<string, MediaEntry>;
  time: number;
  selectedId: string | null;
  onSeek: (t: number) => void;
  onSelect: (id: string | null) => void;
  onChange: (clips: Clip[]) => void;
}

const PCM_RATE = 16000;
const TRACK_H = 72;

export function Timeline({ clips, media, time, selectedId, onSeek, onSelect, onChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(40); // px per second
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [trim, setTrim] = useState<{ id: string; edge: "in" | "out"; x0: number; v0: number } | null>(null);
  const [preview, setPreview] = useState<Clip[] | null>(null);
  const shown = preview ?? clips;
  const total = timelineDuration(shown);
  const starts = clipStarts(shown);
  const width = Math.max(total * zoom + 200, 600);

  // fit to width when a project is first loaded
  const fitted = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!fitted.current && el && total > 0) {
      fitted.current = true;
      setZoom(Math.max(2, Math.min(200, (el.clientWidth - 40) / total)));
    }
  }, [total]);

  // keep the playhead visible while playing
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = time * zoom;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [time, zoom]);

  useEffect(() => {
    if (!trim) return;
    const move = (e: PointerEvent) => {
      const c = clips.find((x) => x.id === trim.id);
      if (!c) return;
      const dv = (e.clientX - trim.x0) / zoom;
      setPreview(trimClip(clips, trim.id, trim.edge, trim.v0 + dv, media[c.mediaId].duration));
    };
    const up = () => {
      if (preview) onChange(preview);
      setPreview(null);
      setTrim(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [trim, clips, media, zoom, preview, onChange]);

  const ticks = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => s * zoom >= 70) ?? 600;
    const out: number[] = [];
    for (let t = 0; t <= total + step; t += step) out.push(t);
    return { list: out, fine: step < 1 };
  }, [total, zoom]);

  const seekFromEvent = (e: React.MouseEvent) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    onSeek((e.clientX - rect.left + el.scrollLeft) / zoom);
  };

  return (
    <div className="timeline">
      <div className="timeline-bar">
        <span className="muted">
          {shown.length} {shown.length === 1 ? "klip" : shown.length < 5 ? "klipy" : "klipů"} · {formatTime(total)}
        </span>
        <label className="zoom">
          Zoom
          <input
            type="range"
            min={1}
            max={300}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-inner" style={{ width }}>
          <div className="ruler" onMouseDown={seekFromEvent}>
            {ticks.list.map((t) => (
              <span key={t} className="tick" style={{ left: t * zoom }}>
                {formatTime(t, ticks.fine)}
              </span>
            ))}
          </div>
          <div className="track" style={{ height: TRACK_H }} onMouseDown={(e) => e.target === e.currentTarget && onSelect(null)}>
            {shown.map((c, i) => (
              <div
                key={c.id}
                className={`clip${c.id === selectedId ? " selected" : ""}${dragFrom === i ? " dragging" : ""}`}
                style={{ left: starts[i] * zoom, width: Math.max(2, clipLength(c) * zoom) }}
                draggable={!trim}
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null) onChange(moveClip(clips, dragFrom, i));
                  setDragFrom(null);
                }}
                onDragEnd={() => setDragFrom(null)}
                onMouseDown={(e) => {
                  onSelect(c.id);
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  onSeek(starts[i] + (e.clientX - rect.left) / zoom);
                }}
                title={`${media[c.mediaId]?.name}\n${formatTime(c.in)} – ${formatTime(c.out)}`}
              >
                <Waveform clip={c} entry={media[c.mediaId]} width={Math.max(2, clipLength(c) * zoom)} />
                <span className="clip-label">{media[c.mediaId]?.name}</span>
                {(["in", "out"] as const).map((edge) => (
                  <span
                    key={edge}
                    className={`handle handle-${edge}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onSelect(c.id);
                      setTrim({ id: c.id, edge, x0: e.clientX, v0: c[edge] });
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="playhead" style={{ left: time * zoom }} />
        </div>
      </div>
    </div>
  );
}

function Waveform({ clip, entry, width }: { clip: Clip; entry?: MediaEntry; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !entry?.pcm) return;
    const w = Math.min(4000, Math.max(1, Math.floor(width)));
    const h = TRACK_H;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const a = Math.floor(clip.in * PCM_RATE);
    const b = Math.min(entry.pcm.length, Math.floor(clip.out * PCM_RATE));
    const per = Math.max(1, (b - a) / w);
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--wave").trim() || "#7dd3fc";
    for (let x = 0; x < w; x++) {
      let m = 0;
      const s = a + Math.floor(x * per);
      const e = Math.min(b, s + Math.ceil(per));
      // sample at most 64 points per column to keep long clips fast
      const stride = Math.max(1, Math.floor((e - s) / 64));
      for (let j = s; j < e; j += stride) m = Math.max(m, Math.abs(entry.pcm[j]));
      const bar = Math.max(1, m * (h - 18));
      ctx.fillRect(x, (h - bar) / 2, 1, bar);
    }
  }, [clip.in, clip.out, entry?.pcm, width]);
  return <canvas ref={ref} className="wave" style={{ width: Math.min(4000, width), height: TRACK_H }} />;
}
