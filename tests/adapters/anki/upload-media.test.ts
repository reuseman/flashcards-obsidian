import { describe, expect, it } from "vitest";

import { AnkiConnectClient } from "../../../src/adapters/anki/anki-connect-client.js";
import { uploadMedia } from "../../../src/adapters/anki/upload-media.js";
import type { ResolvedMedia } from "../../../src/adapters/obsidian/media-resolver.js";
import { bytesToBase64 } from "../../../src/core/utils/base64.js";
import { makeFakeFetch, ok } from "../../_utils/fake-fetch.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function rm(finalName: string, bytes = PNG, mime = "image/png"): ResolvedMedia {
  return { finalName, bytes, mime };
}

describe("uploadMedia", () => {
  it("makes no network call on empty input", async () => {
    const { calls, fetch } = makeFakeFetch([]);
    await uploadMedia(new AnkiConnectClient({ fetch }), []);
    expect(calls).toEqual([]);
  });

  it("uploads a single ResolvedMedia as a `multi` envelope of one storeMediaFile", async () => {
    const { calls, fetch } = makeFakeFetch([
      ok([null]), // multi returns one inner result
    ]);
    await uploadMedia(new AnkiConnectClient({ fetch }), [rm("hash.png")]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.action).toBe("multi");
    const inner = (calls[0]!.params as {
      actions: Array<{ action: string; params: Record<string, unknown> }>;
    }).actions;
    expect(inner).toHaveLength(1);
    expect(inner[0]!.action).toBe("storeMediaFile");
    expect(inner[0]!.params).toEqual({
      filename: "hash.png",
      data: bytesToBase64(PNG),
    });
  });

  it("batches multiple distinct ResolvedMedia into a single multi call", async () => {
    const { calls, fetch } = makeFakeFetch([ok([null, null, null])]);
    await uploadMedia(new AnkiConnectClient({ fetch }), [
      rm("a.png"),
      rm("b.png"),
      rm("c.png"),
    ]);
    expect(calls).toHaveLength(1);
    const inner = (calls[0]!.params as {
      actions: Array<{ params: { filename: string } }>;
    }).actions;
    expect(inner.map((a) => a.params.filename)).toEqual([
      "a.png",
      "b.png",
      "c.png",
    ]);
  });

  it("dedups by finalName before batching", async () => {
    const { calls, fetch } = makeFakeFetch([ok([null, null])]);
    await uploadMedia(new AnkiConnectClient({ fetch }), [
      rm("a.png"),
      rm("a.png"),
      rm("b.png"),
      rm("a.png"),
    ]);
    expect(calls).toHaveLength(1);
    const inner = (calls[0]!.params as {
      actions: Array<{ params: { filename: string } }>;
    }).actions;
    expect(inner.map((a) => a.params.filename)).toEqual(["a.png", "b.png"]);
  });
});
