import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip, Range, Segment, Word } from "../types";
import type { MediaEntry } from "../store";
import { isSourceUsed, locate, sourceToTimeline } from "../lib/timeline";

interface Props {
  media: Record<string, MediaEntry>;
  words: Record<string, Word[]>;
  segments: Record<string, Segment[]>;
  clips: Clip[];
  time: number;
  onSeek: (t: number) => void;
  onCut: (mediaId: string, range: Range) => void;
  onRestore: (mediaId: string, range: Range) => void;
}

interface Sel {
  mediaId: string;
  from: number;
  to: number; // inclusive word indexes
}

export function TranscriptPanel({ media, words, segments, clips, time, onSeek, onCut, onRestore }: Props) {
  const [sel, setSel] = useState<Sel | null>(null);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const loc = locate(clips, time);
  const ids = Object.keys(media).filter((id) => words[id]?.length);

  // capture native text selection as a word range
  useEffect(() => {
    const onChange = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !boxRef.current) return;
      const el = (n: Node | null) =>
        (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-w]") ?? null;
      const a = el(s.anchorNode);
      const b = el(s.focusNode);
      if (!a || !b || !boxRef.current.contains(a) || a.dataset.m !== b.dataset.m) return;
      const x = Number(a.dataset.w);
      const y = Number(b.dataset.w);
      setSel({ mediaId: a.dataset.m!, from: Math.min(x, y), to: Math.max(x, y) });
    };
    // selectionchange also fires for long-press selection on phones (mouseup does not)
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  const selRange = useMemo<Range | null>(() => {
    if (!sel) return null;
    const ws = words[sel.mediaId];
    if (!ws?.[sel.from] || !ws[sel.to]) return null;
    // extend to the gap before the next word so the pause after the selection goes too
    const next = ws[sel.to + 1];
    return { start: ws[sel.from].start, end: next ? Math.min(next.start, ws[sel.to].end + 0.3) : ws[sel.to].end };
  }, [sel, words]);

  const q = query.trim().toLowerCase();

  if (!ids.length) {
    return (
      <div className="empty">
        <p>Zatím tu není přepis.</p>
        <p className="muted">V záložce <b>AI</b> spusť přepis řeči. Pak můžeš střihat video mazáním textu.</p>
      </div>
    );
  }

  return (
    <div className="transcript">
      <div className="transcript-tools">
        <input placeholder="Hledat v přepisu…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button
          disabled={!selRange}
          onClick={() => {
            if (sel && selRange) onCut(sel.mediaId, selRange);
            window.getSelection()?.removeAllRanges();
            setSel(null);
          }}
          title="Vystřihne označený text z videa"
        >
          ✂ Vystřihnout
        </button>
        <button
          disabled={!selRange}
          onClick={() => {
            if (sel && selRange) onRestore(sel.mediaId, selRange);
            window.getSelection()?.removeAllRanges();
            setSel(null);
          }}
          title="Vrátí označený text zpět do videa"
        >
          ↺ Obnovit
        </button>
      </div>
      <p className="muted small"><span className="no-touch">Označ text myší a stiskni Vystřihnout (nebo Delete). Kliknutím na slovo skočíš na jeho místo.</span><span className="touch">Podrž prst na slově, roztáhni výběr a klepni na Vystřihnout. Klepnutím na slovo skočíš na jeho místo.</span></p>
      <div
        className="transcript-body"
        ref={boxRef}
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Delete" || e.key === "Backspace") && sel && selRange) {
            e.preventDefault();
            e.stopPropagation();
            onCut(sel.mediaId, selRange);
            window.getSelection()?.removeAllRanges();
            setSel(null);
          }
        }}
      >
        {ids.map((id) => (
          <div key={id}>
            {ids.length > 1 && <h4>{media[id].name}</h4>}
            {(segments[id] ?? []).map((seg) => (
              <p key={seg.index} className="seg">
                {words[id].slice(seg.wordFrom, seg.wordTo).map((w, k) => {
                  const wi = seg.wordFrom + k;
                  const used = isSourceUsed(clips, id, w.start + 0.01, w.end - 0.01 > w.start ? w.end - 0.01 : w.end);
                  const active = loc?.clip.mediaId === id && loc.sourceTime >= w.start && loc.sourceTime < w.end;
                  const hit = q && w.text.toLowerCase().includes(q);
                  const selected = sel?.mediaId === id && wi >= sel.from && wi <= sel.to;
                  return (
                    <span
                      key={wi}
                      data-w={wi}
                      data-m={id}
                      className={`w${used ? "" : " cut"}${active ? " active" : ""}${hit ? " hit" : ""}${selected ? " sel" : ""}`}
                      onClick={() => {
                        if (window.getSelection()?.isCollapsed !== false) setSel(null);
                        const t = sourceToTimeline(clips, id, w.start);
                        if (t !== null && window.getSelection()?.isCollapsed !== false) onSeek(t);
                      }}
                    >
                      {w.text}{" "}
                    </span>
                  );
                })}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
