import { describe, expect, it } from "vitest";
import type { App } from "obsidian";

import type { MediaRef } from "../../../src/core/render/extract-media.js";
import { resolveMedia } from "../../../src/adapters/obsidian/media-resolver.js";

function ref(filename: string, kind: "image" | "audio" = "image"): MediaRef {
  return {
    kind,
    raw: `![[${filename}]]`,
    filename,
    start: 0,
    end: filename.length + 5,
  };
}

/**
 * Builds a fake Obsidian `App` with:
 *  - `metadataCache.getFirstLinkpathDest(name, source)` → returns a `{ path }`
 *    sentinel for any filename in `present`, else `null`.
 *  - `vault.readBinary(file)` → returns `bytesByPath[file.path]` or throws
 *    `read failure` if `failPaths` includes the path.
 */
function makeApp(opts: {
  bytesByPath: Record<string, Uint8Array>;
  failPaths?: string[];
}): { app: App; lookups: string[]; reads: string[] } {
  const lookups: string[] = [];
  const reads: string[] = [];
  const fail = new Set(opts.failPaths ?? []);
  const app = {
    metadataCache: {
      getFirstLinkpathDest(name: string, _source: string) {
        lookups.push(name);
        if (name in opts.bytesByPath || fail.has(name)) {
          return { path: name } as unknown;
        }
        return null;
      },
    },
    vault: {
      async readBinary(file: { path: string }): Promise<ArrayBuffer> {
        reads.push(file.path);
        if (fail.has(file.path)) {
          throw new Error("read failure");
        }
        const bytes = opts.bytesByPath[file.path]!;
        // Detach into its own buffer.
        return bytes.slice().buffer;
      },
    },
  } as unknown as App;
  return { app, lookups, reads };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// SHA-1 of the above 8 bytes, verified via:
//   printf '\x89\x50\x4e\x47\x0d\x0a\x1a\x0a' | sha1sum
const PNG_SHA1 = "4caece539b039b16e16206ea2478f8c5ffb2ca05";

describe("resolveMedia", () => {
  it("resolves a single ref, hashes bytes, sets finalName + mime", async () => {
    const { app, reads } = makeApp({ bytesByPath: { "diagram.png": PNG } });
    const result = await resolveMedia(app, "note.md", [ref("diagram.png")]);
    expect(result.errors).toEqual([]);
    const got = result.resolved.get("diagram.png");
    expect(got).toBeDefined();
    expect(got!.finalName).toBe(`${PNG_SHA1}.png`);
    expect(got!.mime).toBe("image/png");
    expect(Array.from(got!.bytes)).toEqual(Array.from(PNG));
    expect(reads).toEqual(["diagram.png"]);
  });

  it("dedups refs by filename — one read per unique short name", async () => {
    const { app, reads } = makeApp({ bytesByPath: { "diagram.png": PNG } });
    const refs = [
      ref("diagram.png"),
      ref("diagram.png"),
      ref("diagram.png"),
    ];
    const result = await resolveMedia(app, "note.md", refs);
    expect(result.errors).toEqual([]);
    expect(result.resolved.size).toBe(1);
    expect(reads).toEqual(["diagram.png"]);
  });

  it("records not-found when getFirstLinkpathDest returns null", async () => {
    const { app } = makeApp({ bytesByPath: {} });
    const result = await resolveMedia(app, "note.md", [ref("missing.png")]);
    expect(result.resolved.size).toBe(0);
    expect(result.errors).toEqual([
      { raw: "![[missing.png]]", filename: "missing.png", reason: "not-found" },
    ]);
  });

  it("records read-failed when readBinary throws", async () => {
    const { app } = makeApp({
      bytesByPath: {},
      failPaths: ["broken.png"],
    });
    const result = await resolveMedia(app, "note.md", [ref("broken.png")]);
    expect(result.resolved.size).toBe(0);
    expect(result.errors).toEqual([
      { raw: "![[broken.png]]", filename: "broken.png", reason: "read-failed" },
    ]);
  });

  it("hash is deterministic across calls and independent of ref order", async () => {
    const { app: a } = makeApp({ bytesByPath: { "x.png": PNG } });
    const r1 = await resolveMedia(a, "n.md", [ref("x.png")]);
    const { app: b } = makeApp({ bytesByPath: { "x.png": PNG } });
    const r2 = await resolveMedia(b, "n.md", [ref("x.png")]);
    expect(r1.resolved.get("x.png")!.finalName).toBe(
      r2.resolved.get("x.png")!.finalName,
    );
  });

  it("mime lookup covers common image and audio extensions", async () => {
    const cases: Array<[string, string]> = [
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.jpeg", "image/jpeg"],
      ["a.gif", "image/gif"],
      ["a.svg", "image/svg+xml"],
      ["a.webp", "image/webp"],
      ["a.bmp", "image/bmp"],
      ["a.mp3", "audio/mpeg"],
      ["a.wav", "audio/wav"],
      ["a.ogg", "audio/ogg"],
      ["a.m4a", "audio/mp4"],
      ["a.flac", "audio/flac"],
    ];
    const bytesByPath: Record<string, Uint8Array> = {};
    for (const [name] of cases) bytesByPath[name] = PNG;
    const { app } = makeApp({ bytesByPath });
    const refs = cases.map(([name]) =>
      ref(name, name.endsWith(".mp3") || name.endsWith(".wav") ||
        name.endsWith(".ogg") || name.endsWith(".m4a") ||
        name.endsWith(".flac") ? "audio" : "image"),
    );
    const result = await resolveMedia(app, "n.md", refs);
    for (const [name, mime] of cases) {
      expect(result.resolved.get(name)!.mime).toBe(mime);
    }
  });

  it("preserves original extension lowercased in finalName", async () => {
    const { app } = makeApp({ bytesByPath: { "Pic.PNG": PNG } });
    const result = await resolveMedia(app, "n.md", [
      { kind: "image", raw: "![[Pic.PNG]]", filename: "Pic.PNG", start: 0, end: 12 },
    ]);
    expect(result.resolved.get("Pic.PNG")!.finalName).toBe(`${PNG_SHA1}.png`);
  });
});
