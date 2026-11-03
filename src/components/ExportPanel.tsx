import { useState } from "react";
import type { Caption, Clip } from "../types";
import type { MediaEntry } from "../store";
import { exportTimeline, type ExportFormat, type ExportOptions } from "../lib/ffmpeg";
import { toSRT, toVTT } from "../lib/transcript";
import { formatTime, timelineDuration } from "../lib/timeline";

interface Props {
  clips: Clip[];
  media: Record<string, MediaEntry>;
  captions: Caption[];
}

const FORMATS: [ExportFormat, string][] = [
  ["source", "Jako zdroj"],
  ["1080p", "1080p na šířku (16:9)"],
  ["720p", "720p na šířku (16:9)"],
  ["vertical", "Na výšku 9:16 (Shorts, Reels, TikTok)"],
  ["square", "Čtverec 1:1"],
];

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportPanel({ clips, media, captions }: Props) {
  const [format, setFormat] = useState<ExportFormat>("source");
  const [quality, setQuality] = useState<ExportOptions["quality"]>("balanced");
  const [burn, setBurn] = useState(false);
  const [progress, setProgress] = useState<{ ratio: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const baseName = (media[clips[0]?.mediaId]?.name ?? "video").replace(/\.[^.]+$/, "");

  const run = async () => {
    setError(null);
    setResult(null);
    try {
      const blob = await exportTimeline(clips, media, { format, quality, burnCaptions: burn, captions }, (ratio, message) =>
        setProgress({ ratio, message }),
      );
      download(blob, `${baseName}-strih.mp4`);
      setResult(`Hotovo – ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="export-panel">
      <section>
        <h3>Video</h3>
        <p className="muted small">
          Délka výsledku {formatTime(timelineDuration(clips))}. Renderuje se přímo v prohlížeči (ffmpeg.wasm) – video
          nikam neodchází.
        </p>
        <label>
          Formát
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {FORMATS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          Kvalita
          <select value={quality} onChange={(e) => setQuality(e.target.value as ExportOptions["quality"])}>
            <option value="fast">Rychlý náhled</option>
            <option value="balanced">Vyvážená</option>
            <option value="best">Nejlepší (pomalé)</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={burn} disabled={!captions.length} onChange={(e) => setBurn(e.target.checked)} />
          Vypálit titulky do obrazu {captions.length ? "" : "(nejdřív udělej přepis)"}
        </label>
        <button className="primary" disabled={!clips.length || !!progress} onClick={run}>
          ⬇ Exportovat MP4
        </button>
        {progress && (
          <div className="status">
            {progress.message}
            <progress max={1} value={progress.ratio} />
          </div>
        )}
        {error && <div className="error">{error}</div>}
        {result && <div className="info">{result}</div>}
        <p className="muted small">Dlouhá videa ve vysokém rozlišení můžou v prohlížeči trvat déle než reálný čas.</p>
      </section>
      <section>
        <h3>Titulky</h3>
        <p className="muted small">Titulky odpovídají aktuálnímu střihu ({captions.length} řádků).</p>
        <div className="row">
          <button disabled={!captions.length} onClick={() => download(new Blob([toSRT(captions)], { type: "text/plain" }), `${baseName}.srt`)}>
            SRT
          </button>
          <button disabled={!captions.length} onClick={() => download(new Blob([toVTT(captions)], { type: "text/vtt" }), `${baseName}.vtt`)}>
            VTT
          </button>
        </div>
      </section>
    </div>
  );
}
