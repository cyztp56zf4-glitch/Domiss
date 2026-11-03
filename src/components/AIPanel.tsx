import { useEffect, useState } from "react";
import type { Clip, Range, Segment, Word } from "../types";
import type { MediaEntry } from "../store";
import { detectSilence } from "../lib/audio";
import { transcribe, WHISPER_MODELS } from "../lib/transcribe";
import { DEFAULT_FILLERS, findFillerRanges } from "../lib/transcript";
import {
  clipsFromRanges,
  formatTime,
  isSourceUsed,
  mergeAdjacent,
  removeSourceRanges,
  sourceToTimeline,
  timelineDuration,
} from "../lib/timeline";
import { aiStatus, padSpan, requestPlan, type HighlightPlan, type MetadataPlan } from "../lib/ai";

interface Props {
  media: Record<string, MediaEntry>;
  words: Record<string, Word[]>;
  segments: Segment[];
  clips: Clip[];
  setClips: (c: Clip[]) => void;
  setWords: (mediaId: string, w: Word[]) => void;
  onSeek: (t: number) => void;
}

const LANGS = [
  ["cs", "Čeština"],
  ["sk", "Slovenština"],
  ["en", "Angličtina"],
  ["de", "Němčina"],
  ["auto", "Rozpoznat automaticky"],
] as const;

export function AIPanel({ media, words, segments, clips, setClips, setWords, onSeek }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [model, setModel] = useState<string>(WHISPER_MODELS[0].id);
  const [language, setLanguage] = useState("cs");
  const [threshold, setThreshold] = useState(-42);
  const [minSilence, setMinSilence] = useState(0.6);
  const [padding, setPadding] = useState(0.12);
  const [fillers, setFillers] = useState(DEFAULT_FILLERS.join(", "));
  const [instruction, setInstruction] = useState("");
  const [target, setTarget] = useState("");
  const [highlights, setHighlights] = useState<HighlightPlan["clips"] | null>(null);
  const [metadata, setMetadata] = useState<MetadataPlan | null>(null);
  const [server, setServer] = useState<{ aiConfigured: boolean; model: string } | null | undefined>(undefined);

  useEffect(() => {
    void aiStatus().then(setServer);
  }, []);

  const hasTranscript = segments.length > 0;
  const usedMedia = [...new Set(clips.map((c) => c.mediaId))];
  const usedSegments = segments.filter((s) => isSourceUsed(clips, s.mediaId, s.start, s.end));

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setError(null);
    setInfo(null);
    setProgress(null);
    try {
      const msg = await fn();
      if (msg) setInfo(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const doTranscribe = () =>
    run("Přepis řeči", async () => {
      const targets = usedMedia.length ? usedMedia : Object.keys(media);
      for (const id of targets) {
        const m = media[id];
        if (!m.pcm) throw new Error(`Soubor ${m.name} nemá zvukovou stopu.`);
        const ws = await transcribe(m.pcm, { model, language }, (msg, p) => {
          setBusy(`${m.name}: ${msg}`);
          setProgress(p);
        });
        setWords(id, ws);
      }
      return "Přepis je hotový – najdeš ho v záložce Přepis.";
    });

  const doSilence = () =>
    run("Hledám ticho", async () => {
      let next = clips;
      const before = timelineDuration(clips);
      for (const id of usedMedia) {
        const pcm = media[id].pcm;
        if (!pcm) continue;
        const ranges = detectSilence(pcm, 16000, { thresholdDb: threshold, minSilence, padding });
        next = removeSourceRanges(next, id, ranges);
      }
      setClips(mergeAdjacent(next, 0));
      return `Odstraněno ${formatTime(before - timelineDuration(next))} ticha.`;
    });

  const doFillers = () =>
    run("Odstraňuji vycpávková slova", async () => {
      const list = fillers.split(",").map((s) => s.trim()).filter(Boolean);
      let next = clips;
      let count = 0;
      for (const id of usedMedia) {
        const ranges = findFillerRanges(words[id] ?? [], list);
        count += ranges.length;
        next = removeSourceRanges(next, id, ranges);
      }
      setClips(next);
      return count ? `Vystřiženo ${count} vycpávkových slov.` : "Žádná vycpávková slova nenalezena.";
    });

  const toPayload = (segs: Segment[]) => segs.map((s) => ({ i: s.index, start: s.start, end: s.end, text: s.text }));

  const doCut = () =>
    run("Claude navrhuje střih", async () => {
      const before = timelineDuration(clips);
      const plan = await requestPlan("cut", toPayload(usedSegments), {
        instruction,
        targetSeconds: Number(target) || undefined,
        language,
      });
      const keep = new Set<number>();
      for (const r of plan.keep) for (let i = r.from; i <= r.to; i++) keep.add(i);
      // remove each dropped segment together with the pause that follows it
      const removals: Record<string, Range[]> = {};
      usedSegments.forEach((s, k) => {
        if (keep.has(s.index)) return;
        const next = usedSegments[k + 1];
        const prev = usedSegments[k - 1];
        const start = prev && prev.mediaId === s.mediaId && !keep.has(prev.index) ? prev.end : s.start;
        const end = next && next.mediaId === s.mediaId ? next.start : s.end;
        (removals[s.mediaId] ??= []).push({ start, end });
      });
      let next = clips;
      for (const [id, ranges] of Object.entries(removals)) next = removeSourceRanges(next, id, ranges);
      setClips(next);
      return `${plan.summary}\n\nDélka: ${formatTime(before)} → ${formatTime(timelineDuration(next))}`;
    });

  const doHighlights = () =>
    run("Claude hledá nejlepší momenty", async () => {
      const plan = await requestPlan("highlights", toPayload(usedSegments), { instruction, language });
      setHighlights(plan.clips);
      return plan.clips.length ? `Nalezeno ${plan.clips.length} klipů.` : "Claude nenašel vhodné klipy.";
    });

  const doMetadata = () =>
    run("Claude píše název a popis", async () => {
      // send times relative to the edited timeline so chapters match the exported video
      const timed = usedSegments.map((s) => ({
        i: s.index,
        start: sourceToTimeline(clips, s.mediaId, s.start) ?? 0,
        end: (sourceToTimeline(clips, s.mediaId, s.start) ?? 0) + (s.end - s.start),
        text: s.text,
      }));
      setMetadata(await requestPlan("metadata", timed, { instruction, language }));
    });

  const highlightClips = (h: HighlightPlan["clips"][number]): Clip[] => {
    const span = segments.filter((s) => s.index >= h.from && s.index <= h.to);
    if (!span.length) return [];
    const mediaId = span[0].mediaId;
    const own = segments.filter((s) => s.mediaId === mediaId);
    const r = padSpan(own, { start: span[0].start, end: span[span.length - 1].end }, 0.2, media[mediaId].duration);
    return clipsFromRanges(mediaId, [r]);
  };

  const chapterTime = (segIndex: number) => {
    const s = segments.find((x) => x.index === segIndex);
    return s ? sourceToTimeline(clips, s.mediaId, s.start) ?? 0 : 0;
  };

  const metadataText = metadata
    ? [
        metadata.titles[0] ?? "",
        "",
        metadata.description,
        "",
        ...metadata.chapters
          .map((c, k) => ({ t: k === 0 ? 0 : chapterTime(c.segment), title: c.title }))
          .map((c) => `${formatTime(c.t, false)} ${c.title}`),
        "",
        metadata.tags.map((t) => `#${t.replace(/\s+/g, "")}`).join(" "),
      ].join("\n")
    : "";

  const aiDisabled = !!busy || !hasTranscript || !usedSegments.length || server?.aiConfigured === false;

  return (
    <div className="ai-panel">
      {busy && (
        <div className="status">
          <div className="spinner" /> {busy}
          {progress !== null && <progress max={100} value={progress} />}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {info && <div className="info">{info}</div>}

      <section>
        <h3>1. Přepis řeči</h3>
        <p className="muted small">Běží přímo v prohlížeči (Whisper). Model se stáhne jen poprvé.</p>
        <div className="row">
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {WHISPER_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <button className="primary" disabled={!!busy || !Object.keys(media).length} onClick={doTranscribe}>
          {hasTranscript ? "Přepsat znovu" : "Spustit přepis"}
        </button>
      </section>

      <section>
        <h3>2. Automatické čištění</h3>
        <label className="slider">
          Práh ticha <b>{threshold} dB</b>
          <input type="range" min={-65} max={-20} value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
        </label>
        <label className="slider">
          Min. délka ticha <b>{minSilence.toFixed(1)} s</b>
          <input type="range" min={0.2} max={3} step={0.1} value={minSilence} onChange={(e) => setMinSilence(+e.target.value)} />
        </label>
        <label className="slider">
          Rezerva kolem řeči <b>{Math.round(padding * 1000)} ms</b>
          <input type="range" min={0} max={0.5} step={0.02} value={padding} onChange={(e) => setPadding(+e.target.value)} />
        </label>
        <button disabled={!!busy || !clips.length} onClick={doSilence}>🔇 Vystřihnout ticho</button>
        <details>
          <summary className="small">Vycpávková slova</summary>
          <textarea rows={3} value={fillers} onChange={(e) => setFillers(e.target.value)} />
        </details>
        <button disabled={!!busy || !hasTranscript} onClick={doFillers}>🗣 Vystřihnout „ehm“, „jako“…</button>
      </section>

      <section>
        <h3>3. AI střih (Claude)</h3>
        {server === null && <p className="error small">Server neběží – spusť <code>npm run dev</code>.</p>}
        {server?.aiConfigured === false && (
          <p className="error small">Na serveru chybí <code>ANTHROPIC_API_KEY</code> (soubor <code>.env</code>).</p>
        )}
        {!hasTranscript && <p className="muted small">Nejdřív spusť přepis řeči.</p>}
        <textarea
          rows={3}
          placeholder="Pokyn pro AI, např. „Odstraň opakované pokusy a odbočku o počasí“ nebo „Udělej z toho rychlé 2minutové shrnutí“"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <div className="row">
          <label className="small">
            Cílová délka (s)
            <input type="number" min={5} placeholder="libovolná" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
        </div>
        <div className="row wrap">
          <button className="primary" disabled={aiDisabled} onClick={doCut}>✨ Navrhnout a použít střih</button>
          <button disabled={aiDisabled} onClick={doHighlights}>🎯 Najít klipy na Shorts</button>
          <button disabled={aiDisabled} onClick={doMetadata}>📝 Název, popis, kapitoly</button>
        </div>
        <p className="muted small">Každý zásah jde vrátit přes Ctrl+Z.</p>
      </section>

      {highlights && highlights.length > 0 && (
        <section>
          <h3>Klipy na Shorts</h3>
          <ul className="highlights">
            {highlights.map((h, k) => {
              const cs = highlightClips(h);
              const len = timelineDuration(cs);
              return (
                <li key={k}>
                  <div className="row between">
                    <b>{h.title}</b>
                    <span className="badge">{h.score}/10 · {formatTime(len, false)}</span>
                  </div>
                  <p className="small muted">{h.hook}</p>
                  <div className="row">
                    <button
                      onClick={() => {
                        const s = segments.find((x) => x.index === h.from);
                        const t = s ? sourceToTimeline(clips, s.mediaId, s.start) : null;
                        if (t !== null) onSeek(t);
                      }}
                    >
                      ▶ Přejít
                    </button>
                    <button onClick={() => cs.length && setClips(cs)}>Použít jako časovou osu</button>
                  </div>
                </li>
              );
            })}
          </ul>
          <button onClick={() => setClips(highlights.flatMap(highlightClips))}>Sestavit sestřih ze všech klipů</button>
        </section>
      )}

      {metadata && (
        <section>
          <h3>Podklady k publikaci</h3>
          <ol className="small">
            {metadata.titles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
          <textarea rows={12} readOnly value={metadataText} />
          <button onClick={() => void navigator.clipboard.writeText(metadataText)}>📋 Kopírovat</button>
        </section>
      )}
    </div>
  );
}
