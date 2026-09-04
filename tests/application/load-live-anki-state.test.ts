import { describe, expect, it, vi } from "vitest";

import type { AnkiGateway, MarkdownNote } from "../../src/application/ports.js";
import {
  loadLiveAnkiState,
  uniqueKnownNids,
} from "../../src/application/sync/load-live-anki-state.js";

describe("loadLiveAnkiState", () => {
  it("deduplicates and reads notes and cards in bounded batches", async () => {
    const notesInfo = vi.fn(async (nids: number[]) =>
      [...nids].reverse().map((noteId) => ({ cards: [noteId + 10_000], noteId })),
    );
    const cardsInfo = vi.fn(async (cardIds: number[]) =>
      [...cardIds].reverse().map((cardId) => ({ cardId, deckName: "Default" })),
    );
    const client = { cardsInfo, notesInfo } as unknown as AnkiGateway;
    const nids = Array.from({ length: 513 }, (_, index) => 1_000 + index);

    const state = await loadLiveAnkiState(client, [...nids, nids[0]!]);

    expect(notesInfo.mock.calls.map(([batch]) => batch.length)).toEqual([
      256,
      256,
      1,
    ]);
    expect(cardsInfo.mock.calls.map(([batch]) => batch.length)).toEqual([
      512,
      1,
    ]);
    expect(state.requestedNids).toHaveLength(513);
    expect(state.noteByNid.get(nids[0]!)?.noteId).toBe(nids[0]);
    expect(state.cardById.get(nids[0]! + 10_000)?.deckName).toBe("Default");
  });

  it("does not preload a nid owned by more than one source note", () => {
    const note = (path: string, nid: number): MarkdownNote => ({
      file: {},
      markdown: [
        "---",
        "flashcards:",
        `  q-abcd: { nid: ${nid}, hash: abc }`,
        "---",
      ].join("\n"),
      name: path,
      path,
    });

    expect(uniqueKnownNids([
      note("a.md", 1_788_000_000_001),
      note("b.md", 1_788_000_000_001),
      note("c.md", 1_788_000_000_002),
    ])).toEqual(new Set([1_788_000_000_002]));
  });
});
