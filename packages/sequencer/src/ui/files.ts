// Opening and saving song files. Where the browser has the File System Access API
// (Chromium), Save writes straight back to the opened file, so a song inside a Git
// checkout can be edited, saved and committed in place. Elsewhere, Open uses a file
// input and Save downloads.

import { SONG_EXTENSION } from "@a2f0/dnbm-synth/song/format";

interface FilePickerOptions {
  readonly suggestedName?: string;
  readonly types?: readonly { description: string; accept: Record<string, readonly string[]> }[];
}

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle>;
};

const picker = window as FilePickerWindow;
const SONG_TYPES = [{ description: "dnbm song", accept: { "application/json": [".json"] } }];

export interface OpenedFile {
  readonly text: string;
  readonly name: string;
  readonly handle: FileSystemFileHandle | undefined;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** A cross-origin frame may refuse the pickers; fall back as if they were absent. */
function isRefused(error: unknown): boolean {
  return error instanceof DOMException && error.name === "SecurityError";
}

/** Asks for a song file. Resolves undefined if the user cancels. */
export async function openSongFile(): Promise<OpenedFile | undefined> {
  if (picker.showOpenFilePicker) {
    try {
      const [handle] = await picker.showOpenFilePicker({ types: SONG_TYPES });
      if (!handle) return undefined;
      const file = await handle.getFile();
      return { text: await file.text(), name: file.name, handle };
    } catch (error) {
      if (isAbort(error)) return undefined;
      if (!isRefused(error)) throw error;
    }
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), {
      type: "file",
      accept: ".json,application/json",
    });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      resolve(file ? { text: await file.text(), name: file.name, handle: undefined } : undefined);
    });
    input.addEventListener("cancel", () => resolve(undefined));
    input.click();
  });
}

/** A file name for a song title: "Night Bus" becomes "night-bus.dnbm.json". */
export function songFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "untitled"}${SONG_EXTENSION}`;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Saves song text: to `handle` if given, else to a file the user picks (or a download).
 * Resolves the handle written to, undefined for a download, or null if cancelled.
 */
export async function saveSongFile(
  text: string,
  name: string,
  handle: FileSystemFileHandle | undefined,
): Promise<FileSystemFileHandle | undefined | null> {
  let target = handle;
  if (!target && picker.showSaveFilePicker) {
    try {
      target = await picker.showSaveFilePicker({ suggestedName: name, types: SONG_TYPES });
    } catch (error) {
      if (isAbort(error)) return null;
      if (!isRefused(error)) throw error;
    }
  }
  if (!target) {
    download(new Blob([text], { type: "application/json" }), name);
    return undefined;
  }
  const writable = await target.createWritable();
  await writable.write(text);
  await writable.close();
  return target;
}
