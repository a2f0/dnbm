// The song's copy in browser storage: the editor autosaves to it on every change, and
// mount.ts opens it on the next visit.

export const AUTOSAVE_KEY = "dnbm:song";
export const SAVED_KEY = "dnbm:saved";

/** Reads browser storage, which can throw (private windows, blocked storage). */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is a convenience; the song still lives in memory and in saved files.
  }
}
