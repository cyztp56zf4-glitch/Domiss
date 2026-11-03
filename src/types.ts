/** Imported source file. Times are in seconds of the source media. */
export interface Media {
  id: string;
  name: string;
  url: string; // object URL for preview
  file: File;
  duration: number;
  width: number;
  height: number;
}

/** A piece of a source placed on the timeline: plays media[mediaId] from `in` to `out`. */
export interface Clip {
  id: string;
  mediaId: string;
  in: number;
  out: number;
}

export interface Word {
  text: string;
  start: number; // source seconds
  end: number;
}

/** A sentence-ish group of words used for display and as the unit sent to the AI. */
export interface Segment {
  index: number;
  mediaId: string;
  start: number;
  end: number;
  text: string;
  wordFrom: number; // index into the media's word list (inclusive)
  wordTo: number; // exclusive
}

export interface Range {
  start: number;
  end: number;
}

export interface Caption {
  start: number; // timeline seconds
  end: number;
  text: string;
}
