// What the editor shows and how it plays: state that is not part of the song.

import type { PlayingPosition } from "./audio/engineHost";

export interface Cursor {
  readonly track: number;
  readonly step: number;
}

export interface View {
  /** The pattern in the editor. */
  patternId: string;
  /** The track in the device panel. */
  trackId: string;
  /** The selected step, for keyboard editing. */
  cursor: Cursor | undefined;
  /** Play the arrangement, or loop the pattern in the editor. */
  mode: "song" | "loop";
  /** The arrangement slot song mode starts from. */
  startSlot: number;
  /** In song mode, show the pattern that is playing. */
  follow: boolean;
  playing: boolean;
  position: PlayingPosition | undefined;
  /** The note each melodic track enters next, by track id. */
  penNotes: Map<string, number>;
}
