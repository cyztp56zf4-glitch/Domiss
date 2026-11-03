import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Clip, Media } from "./types";
import { clipStarts, locate, timelineDuration } from "./lib/timeline";

/**
 * Plays an edit list through a single <video> element: when the current clip ends,
 * it jumps (and switches source if needed) to the next clip.
 */
export function usePlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  clips: Clip[],
  media: Record<string, Media>,
) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clipsRef = useRef(clips);
  const indexRef = useRef(0);
  const timeRef = useRef(0);
  const total = timelineDuration(clips);

  const load = useCallback(
    (t: number) => {
      const v = videoRef.current;
      const list = clipsRef.current;
      if (!v || !list.length) return;
      const loc = locate(list, t);
      if (!loc) return;
      indexRef.current = loc.index;
      const m = media[loc.clip.mediaId];
      if (!m) return;
      if (v.dataset.mediaId !== m.id) {
        const wasPlaying = !v.paused;
        v.dataset.mediaId = m.id;
        v.src = m.url;
        v.currentTime = loc.sourceTime;
        if (wasPlaying) void v.play().catch(() => undefined);
      } else if (Math.abs(v.currentTime - loc.sourceTime) > 0.04) {
        v.currentTime = loc.sourceTime;
      }
    },
    [media, videoRef],
  );

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(t, timelineDuration(clipsRef.current)));
      timeRef.current = clamped;
      setTime(clamped);
      load(clamped);
    },
    [load],
  );

  // keep position stable when the edit list changes
  useEffect(() => {
    clipsRef.current = clips;
    const t = Math.min(timeRef.current, timelineDuration(clips));
    timeRef.current = t;
    setTime(t);
    load(t);
  }, [clips, load]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
  }, [videoRef]);

  const play = useCallback(() => {
    const v = videoRef.current;
    if (!v || !clipsRef.current.length) return;
    if (timeRef.current >= timelineDuration(clipsRef.current) - 0.05) seek(0);
    else load(timeRef.current);
    void v.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }, [load, seek, videoRef]);

  const toggle = useCallback(() => (playing ? pause() : play()), [pause, play, playing]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      const list = clipsRef.current;
      const i = indexRef.current;
      const clip = list[i];
      if (v && clip) {
        const starts = clipStarts(list);
        if (v.currentTime >= clip.out - 0.02 || v.ended) {
          const next = list[i + 1];
          if (!next) {
            pause();
            timeRef.current = timelineDuration(list);
            setTime(timeRef.current);
            return;
          }
          indexRef.current = i + 1;
          const m = media[next.mediaId];
          if (v.dataset.mediaId !== next.mediaId) {
            v.dataset.mediaId = next.mediaId;
            v.src = m.url;
            v.currentTime = next.in;
            void v.play().catch(() => undefined);
          } else if (Math.abs(v.currentTime - next.in) > 0.03) {
            v.currentTime = next.in;
          }
          timeRef.current = starts[i + 1];
        } else {
          timeRef.current = starts[i] + Math.max(0, v.currentTime - clip.in);
        }
        setTime(timeRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, media, pause, videoRef]);

  return { time, total, playing, play, pause, toggle, seek };
}
