import type { Word } from "../types";
import type { WorkerRequest, WorkerResponse } from "../workers/whisper.worker";

export const WHISPER_MODELS = [
  { id: "onnx-community/whisper-base_timestamped", label: "Whisper Base (rychlý, ~80 MB)" },
  { id: "onnx-community/whisper-small_timestamped", label: "Whisper Small (přesnější, ~250 MB)" },
] as const;

let worker: Worker | null = null;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/whisper.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

/** Transcribe 16 kHz mono PCM in a background worker. Resolves with word-level timestamps. */
export function transcribe(
  audio: Float32Array,
  opts: { model: string; language: string },
  onProgress: (message: string, progress: number) => void,
): Promise<Word[]> {
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") onProgress(msg.message, msg.progress);
      else {
        w.removeEventListener("message", handler);
        if (msg.type === "result") resolve(msg.words);
        else reject(new Error(msg.message));
      }
    };
    w.addEventListener("message", handler);
    // copy so the caller keeps its buffer (used for waveform/silence detection)
    const copy = audio.slice();
    const req: WorkerRequest = { type: "transcribe", audio: copy, ...opts };
    w.postMessage(req, [copy.buffer]);
  });
}
