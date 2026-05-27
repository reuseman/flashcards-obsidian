import { describe, expect, it, vi } from "vitest";
import type { MetadataCache, TFile } from "obsidian";

import { createWikilinkResolver } from "../../../src/adapters/obsidian/wikilink-resolver.js";

/**
 * Phase 7 — Obsidian-side wikilink resolver factory.
 *
 * Contract:
 *   - Delegates to `metadataCache.getFirstLinkpathDest(target, sourcePath)`.
 *   - Returns the resolved file's `path` verbatim (NOT stripping `.md`).
 *   - Returns `null` when the metadata cache reports no destination.
 */

interface FakeMetadataCache {
  getFirstLinkpathDest: (
    linkpath: string,
    sourcePath: string,
  ) => TFile | null;
}

function makeMetadataCache(
  impl: (linkpath: string, sourcePath: string) => TFile | null,
): MetadataCache {
  const stub: FakeMetadataCache = { getFirstLinkpathDest: impl };
  return stub as unknown as MetadataCache;
}

function fakeFile(path: string): TFile {
  return { path } as unknown as TFile;
}

describe("createWikilinkResolver", () => {
  it("returns null when getFirstLinkpathDest returns null", () => {
    const cache = makeMetadataCache(() => null);
    const resolve = createWikilinkResolver(cache);

    expect(resolve("Missing", "note.md")).toBeNull();
  });

  it("returns the resolved file's path verbatim including the .md extension", () => {
    const cache = makeMetadataCache(() => fakeFile("Some/Note.md"));
    const resolve = createWikilinkResolver(cache);

    expect(resolve("Note", "note.md")).toBe("Some/Note.md");
  });

  it("forwards target and sourcePath unchanged to getFirstLinkpathDest", () => {
    const spy = vi.fn<(linkpath: string, sourcePath: string) => TFile | null>(
      () => fakeFile("X.md"),
    );
    const cache = makeMetadataCache(spy);
    const resolve = createWikilinkResolver(cache);

    resolve("Target Name", "folder/source.md");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("Target Name", "folder/source.md");
  });

  it("resolves nested paths verbatim", () => {
    const cache = makeMetadataCache(() =>
      fakeFile("Folder/Subfolder/Deep Note.md"),
    );
    const resolve = createWikilinkResolver(cache);

    expect(resolve("Deep Note", "x.md")).toBe(
      "Folder/Subfolder/Deep Note.md",
    );
  });
});
