import type { App, TFile } from "obsidian";

import type { MediaRef } from "../../core/render/extract-media.js";

export interface ResolvedMedia {
  finalName: string; // <sha1>.<ext>
  bytes: Uint8Array;
  mime: string;
}

export interface MediaResolutionError {
  raw: string;
  filename: string;
  reason: "not-found" | "read-failed";
}

export interface MediaResolution {
  resolved: Map<string, ResolvedMedia>; // key = original short filename
  errors: MediaResolutionError[];
}

// Tiny MIME table — only the extensions supported by `extractMedia`.
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tiff: "image/tiff",
  webp: "image/webp",
  avif: "image/avif",
  mp3: "audio/mpeg",
  webm: "audio/webm",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  "3gp": "audio/3gpp",
  flac: "audio/flac",
};

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i]!;
    out += v.toString(16).padStart(2, "0");
  }
  return out;
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  // Slice into a fresh, non-shared ArrayBuffer for WebCrypto. Cheap and
  // sidesteps `SharedArrayBuffer` typing complications when the input is a
  // view over an offset slice.
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-1", copy.buffer as ArrayBuffer);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Resolves each unique `MediaRef.filename` against the vault and returns the
 * content-hashed final name + raw bytes + mime per resolved entry. Failures
 * are reported per-ref in `errors`. I/O is performed once per unique short
 * name (dedup by `filename`).
 *
 * Per-note scope invariant: within a single call, `getFirstLinkpathDest` is
 * invoked exactly once per unique short name relative to `sourcePath` — so
 * cross-folder shadowing cannot produce two different files for the same
 * short name inside one note. (Documented to lock this assumption.)
 */
export async function resolveMedia(
  app: App,
  sourcePath: string,
  refs: MediaRef[],
): Promise<MediaResolution> {
  const resolved = new Map<string, ResolvedMedia>();
  const errors: MediaResolutionError[] = [];

  // Dedup refs by filename; remember the first `raw` for error reporting.
  const unique = new Map<string, string>();
  for (const r of refs) {
    if (!unique.has(r.filename)) unique.set(r.filename, r.raw);
  }

  for (const [filename, raw] of unique) {
    const dest = app.metadataCache.getFirstLinkpathDest(filename, sourcePath);
    if (dest === null) {
      errors.push({ raw, filename, reason: "not-found" });
      continue;
    }
    let bytes: Uint8Array;
    try {
      const buf = await app.vault.readBinary(dest as TFile);
      bytes = new Uint8Array(buf);
    } catch {
      errors.push({ raw, filename, reason: "read-failed" });
      continue;
    }
    const hash = await sha1Hex(bytes);
    const ext = extOf(filename);
    const finalName = ext.length > 0 ? `${hash}.${ext}` : hash;
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
    resolved.set(filename, { finalName, bytes, mime });
  }

  return { resolved, errors };
}
