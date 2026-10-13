/**
 * Client for the server's hand-off helpers: watch the Downloads folder for a
 * returned image while a hand-off is pending (Server-Sent Events), fetch a
 * detected file, and fetch an image URL dragged in from the ChatGPT/Gemini tab.
 */
export interface DownloadedFile {
  /** Opaque token for /api/handoff/file. */
  id: string;
  name: string;
  size: number;
  mtime: number;
}

/** Whether the server can watch a folder (and which). */
export declare function handoffWatchStatus(): Promise<{ available: boolean; dir: string | null }>;

/**
 * Starts watching (server side) and calls `onFile` for each new image that
 * appears after now. Returns a stop function (also stops server-side watching).
 */
export declare function watchDownloads(onFile: (f: DownloadedFile) => void, onError?: (err: Error) => void): () => void;

export declare function fetchDownloadedFile(id: string, signal?: AbortSignal): Promise<Blob>;

/** Server-side fetch of a dragged image URL (https only, SSRF-guarded, image/* ≤ 15 MB). */
export declare function fetchImageUrl(url: string, signal?: AbortSignal): Promise<Blob>;
