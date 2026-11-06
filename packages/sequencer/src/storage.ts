// The song's copy in browser storage: the editor autosaves to it on every change, and
// mount.ts opens it on the next visit.

import { parseSongText, SongError } from "@a2f0/dnbm-synth/song/format";
import type { Song } from "@a2f0/dnbm-synth/song/model";

export const AUTOSAVE_KEY = "dnbm:song";
export const SAVED_KEY = "dnbm:saved";
/** Where an autosave this version can't read is kept, since the next autosave replaces it. */
export const UNREADABLE_KEY = "dnbm:song:unreadable";

/** Reads browser storage, which can throw (private windows, blocked storage). */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes browser storage; returns whether it took the value (it may be full or blocked). */
export function writeStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // Storage is a convenience; the song still lives in memory and in saved files.
    return false;
  }
}

/** Writes the editor's song and its saved text to browser storage. */
export type Autosave = (song: string, saved: string) => void;

function autosaveTo(storage: boolean): Autosave {
  return (song, saved) => {
    if (!storage) return;
    writeStorage(AUTOSAVE_KEY, song);
    writeStorage(SAVED_KEY, saved);
  };
}

/** The song a session starts with, where it autosaves, and why the last didn't reopen. */
export interface RestoredSong {
  readonly song: Song;
  readonly saved: string | undefined;
  /** Writes nothing when writing would destroy the only copy of the last song. */
  readonly autosave: Autosave;
  readonly problem?: string;
}

/**
 * Reopens the last session's song from browser storage, or starts from `fallback`. An
 * autosave this version can't read, such as one a newer dnbm wrote on the same site, is
 * copied aside, since the editor's next autosave overwrites it, and `problem` says so.
 * When storage has no room for the copy, the session doesn't autosave at all.
 */
export function restoreSong(fallback: () => Song): RestoredSong {
  const text = readStorage(AUTOSAVE_KEY);
  if (text) {
    try {
      return {
        song: parseSongText(text),
        saved: readStorage(SAVED_KEY) ?? undefined,
        autosave: autosaveTo(true),
      };
    } catch (error) {
      const reason = `Couldn't reopen the last song: ${error instanceof SongError ? error.message : String(error)}.`;
      if (writeStorage(UNREADABLE_KEY, text) && readStorage(UNREADABLE_KEY) === text) {
        return {
          song: fallback(),
          saved: undefined,
          autosave: autosaveTo(true),
          problem: `${reason} A copy is kept in browser storage as ${UNREADABLE_KEY}.`,
        };
      }
      return {
        song: fallback(),
        saved: undefined,
        autosave: autosaveTo(false),
        problem: `${reason} Browser storage has no room for a copy, so this session won't autosave over it.`,
      };
    }
  }
  return { song: fallback(), saved: undefined, autosave: autosaveTo(true) };
}
