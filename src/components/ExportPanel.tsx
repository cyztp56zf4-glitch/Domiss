import { useEffect, useState } from "react";
import type { Caption, Clip } from "../types";
import type { MediaEntry } from "../store";
import { exportTimeline, type ExportFormat, type ExportOptions } from "../lib/ffmpeg";
import { toSRT, toVTT } from "../lib/transcript";
import { formatTime, timelineDuration } from "../lib/timeline";
import {
  downloadBlob,
  ensureWritable,
  folderPickerSupported,
  forgetFolder,
  loadFolder,
  pickFolder,
  writeToFolder,
} from "../lib/saveTarget";

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

export function ExportPanel({ clips, media, captions }: Props) {
  const [format, setFormat] = useState<ExportFormat>("source");
  const [quality, setQuality] = useState<ExportOptions["quality"]>("balanced");
  const [burn, setBurn] = useState(false);
  const [progress, setProgress] = useState<{ ratio: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const baseName = (media[clips[0]?.mediaId]?.name ?? "video").replace(/\.[^.]+$/, "");
  const canPick = folderPickerSupported();

  useEffect(() => {
    if (canPick) void loadFolder().then(setFolder);
  }, [canPick]);

  /** Ask for write access while we're still inside the click (browsers require a user gesture). */
  const prepareFolder = async (): Promise<FileSystemDirectoryHandle | null> => {
    if (!folder) return null;
    try {
      if (await ensureWritable(folder)) return folder;
    } catch {
      /* fall through to download */
    }
    setError(`Bez povolení zápisu do složky „${folder.name}“ – soubor se stáhne do Stažených.`);
    return null;
  };

  const save = async (dir: FileSystemDirectoryHandle | null, blob: Blob, name: string): Promise<string> => {
    if (dir) {
      try {
        const saved = await writeToFolder(dir, name, blob);
        return `Uloženo do „${dir.name}/${saved}“`;
      } catch (e) {
        setError(`Zápis do složky „${dir.name}“ selhal (${e instanceof Error ? e.message : e}) – stahuji místo toho.`);
      }
    }
    downloadBlob(blob, name);
    return `Staženo jako ${name}`;
  };

  const choose = async () => {
    setError(null);
    try {
      const h = await pickFolder();
      if (h) setFolder(h);
    } catch (e) {
      setError(`Složku nejde použít: ${e instanceof Error ? e.message : e}`);
    }
  };

  const saveText = async (text: string, type: string, name: string) => {
    setError(null);
    const dir = await prepareFolder();
    setResult(await save(dir, new Blob([text], { type }), name));
  };

  const run = async () => {
    setError(null);
    setResult(null);
    setShareFile(null);
    const dir = await prepareFolder();
    try {
      const blob = await exportTimeline(clips, media, { format, quality, burnCaptions: burn, captions }, (ratio, message) =>
        setProgress({ ratio, message }),
      );
      const name = `${baseName}-strih.mp4`;
      // iPhone/Android: offer the share sheet ("Uložit video" → Fotky) instead of a download.
      // It needs a fresh tap, so we show a button rather than opening it here.
      const file = new File([blob], name, { type: "video/mp4" });
      if (!dir && navigator.canShare?.({ files: [file] })) {
        setShareFile(file);
        setResult(`Video je hotové (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
        return;
      }
      const where = await save(dir, blob, name);
      setResult(`${where} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
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
        <h3>Kam ukládat</h3>
        {canPick ? (
          <>
            <div className="folder">
              <span className="folder-icon">📁</span>
              <span className="folder-name">{folder ? folder.name : "Stažené soubory (výchozí)"}</span>
            </div>
            <div className="row wrap">
              <button onClick={choose}>{folder ? "Změnit složku / disk" : "Vybrat složku / disk"}</button>
              {folder && (
                <button
                  onClick={() => {
                    void forgetFolder();
                    setFolder(null);
                  }}
                >
                  Zpět na Stažené
                </button>
              )}
            </div>
            <p className="muted small">
              Vyber libovolnou složku na jakémkoli disku (např. externí disk nebo D:). Aplikace si ji zapamatuje a
              exporty i titulky ukládá rovnou tam. Stejně pojmenovaný soubor nepřepíše – přidá „(2)“.
            </p>
          </>
        ) : (
          <p className="muted small">
            Tento prohlížeč neumí ukládat do vybrané složky – soubory jdou do Stažených. Pro výběr disku použij Chrome
            nebo Edge na počítači.
          </p>
        )}
      </section>
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
        {shareFile && (
          <div className="row wrap">
            <button
              className="primary"
              onClick={() =>
                void navigator.share({ files: [shareFile], title: shareFile.name }).catch((e) => {
                  if (!(e instanceof DOMException && e.name === "AbortError")) setError(String(e));
                })
              }
            >
              📲 Uložit do Fotek / sdílet
            </button>
            <button onClick={() => downloadBlob(shareFile, shareFile.name)}>Stáhnout do Souborů</button>
          </div>
        )}
        <p className="muted small">Dlouhá videa ve vysokém rozlišení můžou v prohlížeči trvat déle než reálný čas.</p>
      </section>
      <section>
        <h3>Titulky</h3>
        <p className="muted small">Titulky odpovídají aktuálnímu střihu ({captions.length} řádků).</p>
        <div className="row">
          <button disabled={!captions.length} onClick={() => void saveText(toSRT(captions), "text/plain", `${baseName}.srt`)}>
            SRT
          </button>
          <button disabled={!captions.length} onClick={() => void saveText(toVTT(captions), "text/vtt", `${baseName}.vtt`)}>
            VTT
          </button>
        </div>
      </section>
    </div>
  );
}
