import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import fontUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";
import type { Caption, Clip, Media } from "../types";
import { clipLength, timelineDuration } from "./timeline";

let instance: Promise<FFmpeg> | null = null;

export function getFFmpeg(): Promise<FFmpeg> {
  if (!instance) {
    instance = (async () => {
      const ff = new FFmpeg();
      // core is bundled with the app (no CDN needed)
      await ff.load({ coreURL: new URL(coreURL, location.href).href, wasmURL: new URL(wasmURL, location.href).href });
      return ff;
    })();
    instance.catch(() => (instance = null));
  }
  return instance;
}

export type ExportFormat = "source" | "1080p" | "720p" | "vertical" | "square";

export interface ExportOptions {
  format: ExportFormat;
  quality: "fast" | "balanced" | "best";
  burnCaptions: boolean;
  captions: Caption[];
}

export function outputSize(format: ExportFormat, first: Media): { w: number; h: number; fill: boolean } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  switch (format) {
    case "1080p":
      return { w: 1920, h: 1080, fill: false };
    case "720p":
      return { w: 1280, h: 720, fill: false };
    case "vertical":
      return { w: 1080, h: 1920, fill: true };
    case "square":
      return { w: 1080, h: 1080, fill: true };
    default:
      return { w: even(first.width || 1280), h: even(first.height || 720), fill: false };
  }
}

/** Escape a path for use inside an ffmpeg filter argument. */
const filterPath = (p: string) => p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");

/**
 * Build ffmpeg arguments that render the timeline. Each clip is opened as its own
 * input with fast input seeking (-ss/-t), normalized to one size/fps/audio format,
 * then concatenated. Pure function so it can be unit-tested.
 */
export function buildExportArgs(
  clips: Clip[],
  media: Record<string, Media & { hasAudio?: boolean }>,
  inputPath: (m: Media) => string,
  opts: Pick<ExportOptions, "format" | "quality"> & { subtitlesPath?: string; fontsDir?: string },
  output = "out.mp4",
): string[] {
  if (!clips.length) throw new Error("Časová osa je prázdná.");
  const first = media[clips[0].mediaId];
  const { w, h, fill } = outputSize(opts.format, first);
  const args: string[] = [];
  const filters: string[] = [];
  const fit = fill
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;

  clips.forEach((c, i) => {
    const m = media[c.mediaId];
    const len = clipLength(c).toFixed(3);
    args.push("-ss", c.in.toFixed(3), "-t", len, "-i", inputPath(m));
    filters.push(`[${i}:v]setpts=PTS-STARTPTS,${fit},setsar=1,fps=30,format=yuv420p[v${i}]`);
    if (m.hasAudio === false) {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${len}[a${i}]`);
    } else {
      filters.push(
        `[${i}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`,
      );
    }
  });
  const pairs = clips.map((_, i) => `[v${i}][a${i}]`).join("");
  const videoOut = opts.subtitlesPath ? "vc" : "vout";
  filters.push(`${pairs}concat=n=${clips.length}:v=1:a=1[${videoOut}][aout]`);
  if (opts.subtitlesPath) {
    const fonts = opts.fontsDir ? `:fontsdir=${filterPath(opts.fontsDir)}` : "";
    filters.push(`[vc]subtitles=${filterPath(opts.subtitlesPath)}${fonts}[vout]`);
  }

  const preset = { fast: "ultrafast", balanced: "veryfast", best: "medium" }[opts.quality];
  const crf = { fast: "28", balanced: "23", best: "20" }[opts.quality];
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", preset, "-crf", crf,
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    output,
  );
  return args;
}

/** Captions → ASS with a bold, outlined, bottom-centred style sized for the output. */
export function toASS(captions: Caption[], w: number, h: number): string {
  const size = Math.round(Math.min(w, h) * (h > w ? 0.065 : 0.055));
  const margin = Math.round(h * (h > w ? 0.18 : 0.07));
  const t = (s: number) => {
    const cs = Math.round(s * 100);
    const hh = Math.floor(cs / 360000);
    const mm = Math.floor((cs % 360000) / 6000);
    const ss = Math.floor((cs % 6000) / 100);
    const c = cs % 100;
    return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
  };
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\n/g, "\\N");
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,DejaVu Sans,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(size / 12))},1,2,${Math.round(w * 0.06)},${Math.round(w * 0.06)},${margin},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...captions.map((c) => `Dialogue: 0,${t(c.start)},${t(c.end)},Default,,0,0,0,,${esc(c.text)}`),
    "",
  ].join("\n");
}

/** Render the timeline to an MP4 blob in the browser. */
export async function exportTimeline(
  clips: Clip[],
  media: Record<string, Media & { hasAudio?: boolean }>,
  opts: ExportOptions,
  onProgress: (ratio: number, message: string) => void,
): Promise<Blob> {
  onProgress(0, "Načítám ffmpeg…");
  const ff = await getFFmpeg();
  const total = timelineDuration(clips);
  const used = [...new Set(clips.map((c) => c.mediaId))].map((id) => media[id]);
  const names = new Map<string, string>();
  used.forEach((m, i) => {
    const ext = (m.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4").toLowerCase();
    names.set(m.id, `src${i}${ext}`);
  });

  const onLog = ({ message }: { message: string }) => {
    const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
    if (match && total > 0) {
      const t = +match[1] * 3600 + +match[2] * 60 + +match[3];
      onProgress(Math.min(0.99, t / total), "Renderuji video…");
    }
  };
  ff.on("log", onLog);

  await ff.createDir("/input").catch(() => undefined);
  await ff.createDir("/work").catch(() => undefined);
  // WORKERFS reads straight from the File objects – no copy of the whole video into memory
  await ff.mount(
    FFFSType.WORKERFS,
    { blobs: used.map((m) => ({ name: names.get(m.id)!, data: m.file })) },
    "/input",
  );

  try {
    let subtitlesPath: string | undefined;
    let fontsDir: string | undefined;
    if (opts.burnCaptions && opts.captions.length) {
      const { w, h } = outputSize(opts.format, media[clips[0].mediaId]);
      await ff.writeFile("/work/subs.ass", toASS(opts.captions, w, h));
      await ff.createDir("/fonts").catch(() => undefined);
      const font = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
      await ff.writeFile("/fonts/DejaVuSans-Bold.ttf", font);
      subtitlesPath = "/work/subs.ass";
      fontsDir = "/fonts";
    }
    const args = buildExportArgs(
      clips,
      media,
      (m) => `/input/${names.get(m.id)}`,
      { ...opts, subtitlesPath, fontsDir },
      "/work/out.mp4",
    );
    onProgress(0, "Renderuji video…");
    const code = await ff.exec(args);
    if (code !== 0) throw new Error(`ffmpeg skončil s chybou (kód ${code}). Detaily v konzoli.`);
    const data = await ff.readFile("/work/out.mp4");
    await ff.deleteFile("/work/out.mp4").catch(() => undefined);
    onProgress(1, "Hotovo");
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
  } finally {
    ff.off("log", onLog);
    await ff.unmount("/input").catch(() => undefined);
  }
}
