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

/** The song a session starts with, and why the last session's song didn't reopen. */
export interface RestoredSong {
  readonly song: Song;
  readonly saved: string | undefined;
  /** False when the session must not autosave, as that would destroy the last song. */
  readonly autosave: boolean;
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
        autosave: true,
      };
    } catch (error) {
      const reason = `Couldn't reopen the last song: ${error instanceof SongError ? error.message : String(error)}.`;
      if (writeStorage(UNREADABLE_KEY, text) && readStorage(UNREADABLE_KEY) === text) {
        return {
          song: fallback(),
          saved: undefined,
          autosave: true,
          problem: `${reason} A copy is kept in browser storage as ${UNREADABLE_KEY}.`,
        };
      }
      return {
        song: fallback(),
        saved: undefined,
        autosave: false,
        problem: `${reason} Browser storage has no room for a copy, so this session won't autosave over it.`,
      };
    }
  }
  return { song: fallback(), saved: undefined, autosave: true };
}
