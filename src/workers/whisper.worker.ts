/// <reference lib="webworker" />
import { pipeline, type ProgressInfo } from "@huggingface/transformers";

type Transcriber = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;

export type WorkerRequest = {
  type: "transcribe";
  audio: Float32Array;
  model: string;
  language: string;
};

export type WorkerResponse =
  | { type: "progress"; stage: "download" | "transcribe"; progress: number; message: string }
  | { type: "result"; words: { text: string; start: number; end: number }[] }
  | { type: "error"; message: string };

const cache = new Map<string, Promise<Transcriber>>();

function post(msg: WorkerResponse) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

async function getTranscriber(model: string): Promise<Transcriber> {
  let p = cache.get(model);
  if (!p) {
    const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
    const progress_callback = (info: ProgressInfo) => {
      if (info.status === "progress_total") {
        post({
          type: "progress",
          stage: "download",
          progress: info.progress,
          message: `Stahuji model ${model} (${Math.round(info.progress)} %)`,
        });
      }
    };
    const create = (device: "webgpu" | "wasm") =>
      pipeline("automatic-speech-recognition", model, {
        device,
        dtype: device === "webgpu" ? "fp32" : "q8",
        progress_callback,
      }) as unknown as Promise<Transcriber>;
    p = (hasWebGPU ? create("webgpu").catch(() => create("wasm")) : create("wasm"));
    cache.set(model, p);
    p.catch(() => cache.delete(model));
  }
  return p;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type !== "transcribe") return;
  try {
    const transcriber = await getTranscriber(req.model);
    post({ type: "progress", stage: "transcribe", progress: 0, message: "Přepisuji řeč…" });
    const out = await transcriber(req.audio, {
      language: req.language === "auto" ? undefined : req.language,
      task: "transcribe",
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const duration = req.audio.length / 16000;
    const words = (out.chunks ?? [])
      .map((c) => ({
        text: c.text.trim(),
        start: c.timestamp[0] ?? 0,
        end: c.timestamp[1] ?? Math.min(duration, (c.timestamp[0] ?? 0) + 0.3),
      }))
      .filter((w) => w.text.length > 0 && w.end >= w.start);
    post({ type: "result", words });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
