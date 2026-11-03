import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProject, type MediaEntry } from "./store";
import { usePlayer } from "./usePlayer";
import { Timeline } from "./components/Timeline";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { AIPanel } from "./components/AIPanel";
import { ExportPanel } from "./components/ExportPanel";
import { decodeAudio } from "./lib/audio";
import { buildCaptions, buildSegments } from "./lib/transcript";
import { formatTime, moveClip, removeSourceRanges, restoreSourceRange, splitAt, uid } from "./lib/timeline";
import type { Segment } from "./types";

type Tab = "transcript" | "ai" | "export";

function probe(file: File): Promise<{ url: string; duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error(`Nepodařilo se načíst ${file.name} (vypršel čas).`));
    }, 20000);
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve({ url, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    };
    v.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error(`Prohlížeč neumí otevřít ${file.name}. Zkus MP4 (H.264) nebo WebM.`));
    };
    v.src = url;
  });
}

export default function App() {
  const { state, addMedia, setPcm, setWords, setClips, select, undo, redo } = useProject();
  const { media, words, clips, selectedClipId } = state;
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const player = usePlayer(videoRef, clips, media);
  const [tab, setTab] = useState<Tab>("ai");
  const [showCaptions, setShowCaptions] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const segmentsByMedia = useMemo(() => {
    const out: Record<string, Segment[]> = {};
    let offset = 0;
    for (const id of Object.keys(media)) {
      if (!words[id]?.length) continue;
      out[id] = buildSegments(id, words[id], { startIndex: offset });
      offset += out[id].length;
    }
    return out;
  }, [media, words]);
  const allSegments = useMemo(() => Object.values(segmentsByMedia).flat(), [segmentsByMedia]);
  const captions = useMemo(() => buildCaptions(clips, words), [clips, words]);
  const caption = showCaptions ? captions.find((c) => player.time >= c.start && player.time < c.end) : undefined;

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) continue;
        try {
          setImporting(`Načítám ${file.name}…`);
          const meta = await probe(file);
          const id = uid("m");
          const entry: MediaEntry = { id, name: file.name, file, hasAudio: true, ...meta };
          addMedia(entry);
          setImporting(`Analyzuji zvuk ${file.name}…`);
          try {
            setPcm(id, await decodeAudio(file));
          } catch {
            // could be "no audio track" or a codec/size the browser can't decode – export handles both
            addMedia({ ...entry, hasAudio: undefined }, false);
          }
        } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
        }
      }
      setImporting(null);
    },
    [addMedia, setPcm],
  );

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, .transcript-body")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key.toLowerCase() === "s" && !mod) {
        setClips(splitAt(clips, player.time));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedClipId) {
        setClips(clips.filter((c) => c.id !== selectedClipId));
      } else if (e.key === "ArrowLeft") {
        player.seek(player.time - (e.shiftKey ? 5 : 1 / 30));
      } else if (e.key === "ArrowRight") {
        player.seek(player.time + (e.shiftKey ? 5 : 1 / 30));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, clips, selectedClipId, setClips, undo, redo]);

  const empty = Object.keys(media).length === 0;
  const selectedIndex = clips.findIndex((c) => c.id === selectedClipId);
  const shift = (d: number) => selectedIndex >= 0 && setClips(moveClip(clips, selectedIndex, selectedIndex + d));

  return (
    <div
      className={`app${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        void importFiles(e.dataTransfer.files);
      }}
    >
      <header>
        <div className="brand">
          <span className="logo">✂</span> Domiss <span className="muted">AI střih</span>
        </div>
        <div className="toolbar">
          <button onClick={() => fileRef.current?.click()}>＋<span className="lbl"> Přidat video</span></button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*,audio/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button onClick={undo} disabled={!state.past.length} title="Zpět (Ctrl+Z)">↶</button>
          <button onClick={redo} disabled={!state.future.length} title="Znovu (Ctrl+Shift+Z)">↷</button>
          <button onClick={() => setClips(splitAt(clips, player.time))} disabled={!clips.length} title="Rozdělit (S)">
            ⧉<span className="lbl"> Rozdělit</span>
          </button>
          <button onClick={() => shift(-1)} disabled={selectedIndex <= 0} title="Posunout klip doleva">◀</button>
          <button
            onClick={() => shift(1)}
            disabled={selectedIndex < 0 || selectedIndex >= clips.length - 1}
            title="Posunout klip doprava"
          >
            ▶
          </button>
          <button
            onClick={() => selectedClipId && setClips(clips.filter((c) => c.id !== selectedClipId))}
            disabled={!selectedClipId}
            title="Smazat klip (Delete)"
          >
            🗑<span className="lbl"> Smazat klip</span>
          </button>
        </div>
      </header>

      {empty ? (
        <main className="welcome">
          <div className="drop" onClick={() => fileRef.current?.click()}>
            <div className="big">🎬</div>
            <h1><span className="no-touch">Přetáhni sem video</span><span className="touch">Vyber video</span></h1>
            <p className="muted"><span className="no-touch">nebo klikni a vyber soubor (MP4, MOV, WebM…)</span><span className="touch">klepni sem a vyber video z Fotek nebo Souborů</span></p>
            {importing && <p>{importing}</p>}
          </div>
          <ul className="features">
            <li><b>Přepis řeči</b> přímo v prohlížeči, i česky</li>
            <li><b>Střih mazáním textu</b> v přepisu</li>
            <li><b>Automatické odstranění ticha</b> a „ehm“</li>
            <li><b>AI střih</b> podle pokynu, klipy na Shorts, název a kapitoly</li>
            <li><b>Export</b> MP4 (i 9:16) s vypálenými titulky, SRT/VTT</li>
          </ul>
        </main>
      ) : (
        <main className="workspace">
          <div className="preview">
            <div className="video-wrap">
              <video ref={videoRef} playsInline onClick={player.toggle} />
              {caption && <div className="caption">{caption.text}</div>}
              {!clips.length && <div className="video-empty">Časová osa je prázdná</div>}
            </div>
            <div className="transport">
              <button className="play" onClick={player.toggle} disabled={!clips.length}>
                {player.playing ? "❚❚" : "▶"}
              </button>
              <span className="time">
                {formatTime(player.time)} / {formatTime(player.total)}
              </span>
              <label className="check small">
                <input type="checkbox" checked={showCaptions} onChange={(e) => setShowCaptions(e.target.checked)} />
                Titulky
              </label>
              {importing && <span className="muted small">{importing}</span>}
            </div>
          </div>
          <aside className="side">
            <nav className="tabs">
              {(
                [
                  ["ai", "AI nástroje"],
                  ["transcript", "Přepis"],
                  ["export", "Export"],
                ] as [Tab, string][]
              ).map(([t, l]) => (
                <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                  {l}
                </button>
              ))}
            </nav>
            <div className="tab-body">
              {tab === "ai" && (
                <AIPanel
                  media={media}
                  words={words}
                  segments={allSegments}
                  clips={clips}
                  setClips={setClips}
                  setWords={setWords}
                  onSeek={player.seek}
                />
              )}
              {tab === "transcript" && (
                <TranscriptPanel
                  media={media}
                  words={words}
                  segments={segmentsByMedia}
                  clips={clips}
                  time={player.time}
                  onSeek={player.seek}
                  onCut={(id, r) => setClips(removeSourceRanges(clips, id, [r]))}
                  onRestore={(id, r) => setClips(restoreSourceRange(clips, id, r))}
                />
              )}
              {tab === "export" && <ExportPanel clips={clips} media={media} captions={captions} />}
            </div>
          </aside>
          <Timeline
            clips={clips}
            media={media}
            time={player.time}
            selectedId={selectedClipId}
            onSeek={player.seek}
            onSelect={select}
            onChange={setClips}
          />
        </main>
      )}
    </div>
  );
}
