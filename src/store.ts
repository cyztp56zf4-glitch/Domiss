import { useCallback, useMemo, useReducer } from "react";
import type { Clip, Media, Word } from "./types";

export interface MediaEntry extends Media {
  /** false = no audio track, undefined = couldn't decode it in the browser (export will find out) */
  hasAudio?: boolean;
  pcm?: Float32Array; // 16 kHz mono, for waveform + silence detection
}

export interface ProjectState {
  media: Record<string, MediaEntry>;
  words: Record<string, Word[]>;
  clips: Clip[];
  past: Clip[][];
  future: Clip[][];
  selectedClipId: string | null;
}

type Action =
  | { type: "addMedia"; media: MediaEntry; appendClip: boolean }
  | { type: "setPcm"; mediaId: string; pcm: Float32Array }
  | { type: "setWords"; mediaId: string; words: Word[] }
  | { type: "setClips"; clips: Clip[] }
  | { type: "select"; id: string | null }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 100;

function reducer(state: ProjectState, action: Action): ProjectState {
  switch (action.type) {
    case "addMedia": {
      const m = action.media;
      const media = { ...state.media, [m.id]: m };
      if (!action.appendClip) return { ...state, media };
      const clip: Clip = { id: `clip-${m.id}`, mediaId: m.id, in: 0, out: m.duration };
      return withClips({ ...state, media }, [...state.clips, clip]);
    }
    case "setPcm":
      return {
        ...state,
        media: { ...state.media, [action.mediaId]: { ...state.media[action.mediaId], pcm: action.pcm } },
      };
    case "setWords":
      return { ...state, words: { ...state.words, [action.mediaId]: action.words } };
    case "setClips":
      return withClips(state, action.clips);
    case "select":
      return { ...state, selectedClipId: action.id };
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { ...state, clips: prev, past: state.past.slice(0, -1), future: [state.clips, ...state.future] };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...state, clips: next, past: [...state.past, state.clips], future: rest };
    }
  }
}

function withClips(state: ProjectState, clips: Clip[]): ProjectState {
  if (clips === state.clips) return state;
  const selected = clips.some((c) => c.id === state.selectedClipId) ? state.selectedClipId : null;
  return {
    ...state,
    clips,
    past: [...state.past, state.clips].slice(-HISTORY_LIMIT),
    future: [],
    selectedClipId: selected,
  };
}

const initial: ProjectState = { media: {}, words: {}, clips: [], past: [], future: [], selectedClipId: null };

export function useProject() {
  const [state, dispatch] = useReducer(reducer, initial);
  const setClips = useCallback((clips: Clip[]) => dispatch({ type: "setClips", clips }), []);
  const actions = useMemo(
    () => ({
      addMedia: (media: MediaEntry, appendClip = true) => dispatch({ type: "addMedia", media, appendClip }),
      setPcm: (mediaId: string, pcm: Float32Array) => dispatch({ type: "setPcm", mediaId, pcm }),
      setWords: (mediaId: string, words: Word[]) => dispatch({ type: "setWords", mediaId, words }),
      setClips,
      select: (id: string | null) => dispatch({ type: "select", id }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
    }),
    [setClips],
  );
  return { state, ...actions };
}
