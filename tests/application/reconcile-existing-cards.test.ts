import { describe, expect, it, vi } from "vitest";

import { reconcileExistingCards } from "../../src/application/sync/reconcile-existing-cards.js";
import { syncNote } from "../../src/application/sync-note.js";
import type { AnkiGateway, MarkdownNote } from "../../src/application/ports.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import {
  computeCardHash,
  computeRenderedFieldsHash,
} from "../../src/core/edits/card-hash.js";
import type { IdentifiedFlashcard } from "../../src/core/domain/card.js";
import type { ParsedCardFrontmatter } from "../../src/core/sync/parse-card-frontmatter.js";
import type { SyncPlan } from "../../src/core/sync/sync-plan.js";

const NID = 1_788_437_385_159;

function card(overrides: Partial<IdentifiedFlashcard> = {}): IdentifiedFlashcard {
  return {
    answer: "A",
    blockId: "q-aaaa",
    deckName: "Default",
    front: "Q",
    kind: "basic",
    source: { endOffset: 4, line: 1, startOffset: 0, syntax: "inline" },
    tags: [],
    ...overrides,
  };
}

function frontmatter(
  c: IdentifiedFlashcard,
  sync?: string,
): ParsedCardFrontmatter {
  return {
    entries: [
      {
        blockId: c.blockId,
        hash: computeCardHash(c),
        nid: NID,
        ...(sync !== undefined ? { sync } : {}),
      },
    ],
    skippedLineCount: 0,
  };
}

function plan(update: SyncPlan["update"] = []): SyncPlan {
  return { create: [], delete: [], update };
}

function gateway(overrides: Partial<AnkiGateway>): AnkiGateway {
  return overrides as AnkiGateway;
}

describe("reconcileExistingCards", () => {
  it("turns a matching frontmatter entry into CREATE when its Anki note is missing", async () => {
    const c = card();
    const cardsInfo = vi.fn();
    const result = await reconcileExistingCards({
      cards: [c],
      client: gateway({
        cardsInfo,
        notesInfo: vi.fn(async () => [{}]),
      }),
      frontmatter: frontmatter(c),
      plan: plan(),
    });

    expect(result.recoveredMissingCount).toBe(1);
    expect(result.plan.create).toEqual([{ card: c, hash: computeCardHash(c) }]);
    expect(result.plan.update).toEqual([]);
    expect(cardsInfo).not.toHaveBeenCalled();
  });

  it("adds a deck-only UPDATE when Anki is in a different deck", async () => {
    const c = card({ deckName: "Source deck" });
    const hash = computeCardHash(c);
    const result = await reconcileExistingCards({
      cards: [c],
      client: gateway({
        cardsInfo: vi.fn(async () => [
          { cardId: 91, deckName: "Manual deck", note: NID },
        ]),
        notesInfo: vi.fn(async () => [
          { cards: [91], modelName: "Obsidian-basic", noteId: NID, tags: ["manual"] },
        ]),
      }),
      frontmatter: frontmatter(c),
      plan: plan(),
    });

    expect(result.plan.update).toEqual([
      expect.objectContaining({
        card: c,
        existing: {
          cards: [{ cardId: 91, deckName: "Manual deck" }],
          modelName: "Obsidian-basic",
          tags: ["manual"],
        },
        newHash: hash,
        nid: NID,
        oldHash: hash,
      }),
    ]);
  });

  it("adds an UPDATE when authored Anki tags differ from Obsidian", async () => {
    const c = card({ tags: ["source"] });
    const hash = computeCardHash(c);
    const result = await reconcileExistingCards({
      cards: [c],
      client: gateway({
        cardsInfo: vi.fn(async () => [{ cardId: 91, deckName: "Default", note: NID }]),
        notesInfo: vi.fn(async () => [
          {
            cards: [91],
            modelName: "Obsidian-basic",
            noteId: NID,
            tags: ["manual", "leech"],
          },
        ]),
      }),
      frontmatter: frontmatter(c),
      plan: plan(),
    });

    expect(result.plan.update).toEqual([
      expect.objectContaining({
        card: c,
        existing: expect.objectContaining({ tags: ["manual", "leech"] }),
        newHash: hash,
        nid: NID,
        oldHash: hash,
      }),
    ]);
  });

  it("does not update tags when Obsidian tags and Anki review tags are already correct", async () => {
    const c = card({ tags: ["source"] });
    const result = await reconcileExistingCards({
      cards: [c],
      client: gateway({
        cardsInfo: vi.fn(async () => [{ cardId: 91, deckName: "Default", note: NID }]),
        notesInfo: vi.fn(async () => [
          {
            cards: [91],
            modelName: "Obsidian-basic",
            noteId: NID,
            tags: ["marked", "source", "leech"],
          },
        ]),
      }),
      frontmatter: frontmatter(c),
      plan: plan(),
    });

    expect(result.plan.update).toEqual([]);
  });

  it("adds an UPDATE when a live Anki field changed after the last sync", async () => {
    const c = card();
    const syncedFields = {
      Front: "<p>Q</p>",
      Back: "<p>A</p>",
      Context: "",
      Source: "source",
    };
    const result = await reconcileExistingCards({
      cards: [c],
      client: gateway({
        cardsInfo: vi.fn(async () => [{ cardId: 91, deckName: "Default", note: NID }]),
        notesInfo: vi.fn(async () => [
          {
            cards: [91],
            fields: {
              Front: { order: 0, value: "manual edit" },
              Back: { order: 1, value: "<p>A</p>" },
              Context: { order: 2, value: "" },
              Source: { order: 3, value: "source" },
            },
            modelName: "Obsidian-basic",
            noteId: NID,
            tags: [],
          },
        ]),
      }),
      frontmatter: frontmatter(c, computeRenderedFieldsHash(syncedFields)),
      plan: plan(),
    });

    expect(result.plan.update).toEqual([
      expect.objectContaining({
        card: c,
        existing: expect.objectContaining({
          fields: {
            Back: "<p>A</p>",
            Context: "",
            Front: "manual edit",
            Source: "source",
          },
        }),
        nid: NID,
      }),
    ]);
  });

  it("does not update fields when their live hash matches the last sync", async () => {
    const c = card();
    const fields = {
      Front: "<p>Q</p>",
      Back: "<p>A</p>",
      Context: "",
      Source: "source",
    };
    const result = await reconcileExistingCards({
      cards: [c],
      client: gateway({
        cardsInfo: vi.fn(async () => [{ cardId: 91, deckName: "Default", note: NID }]),
        notesInfo: vi.fn(async () => [
          {
            cards: [91],
            fields: {
              Front: { order: 0, value: fields.Front },
              Back: { order: 1, value: fields.Back },
              Context: { order: 2, value: fields.Context },
              Source: { order: 3, value: fields.Source },
            },
            modelName: "Obsidian-basic",
            noteId: NID,
            tags: [],
          },
        ]),
      }),
      frontmatter: frontmatter(c, computeRenderedFieldsHash(fields)),
      plan: plan(),
    });

    expect(result.plan.update).toEqual([]);
  });

  it("marks basic-to-reversed as an in-place model update without asking", async () => {
    const c = card({ kind: "reversed" });
    const update = {
      card: c,
      newHash: computeCardHash(c),
      nid: NID,
      oldHash: "oldhash",
    };
    const confirm = vi.fn();
    const result = await reconcileExistingCards({
      cards: [c],
      client: gateway({
        cardsInfo: vi.fn(async () => [{ cardId: 91, deckName: "Default", note: NID }]),
        notesInfo: vi.fn(async () => [
          { cards: [91], modelName: "Obsidian-basic", noteId: NID, tags: ["manual"] },
        ]),
      }),
      confirmKindRecreations: confirm,
      frontmatter: frontmatter(c),
      plan: plan([update]),
    });

    expect(result.plan.update[0]).toEqual(
      expect.objectContaining({ existing: expect.objectContaining({ modelName: "Obsidian-basic" }) }),
    );
    expect(result.plan.update[0]!.recreate).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("migrates a v1 spaced note to reminder in place without asking", async () => {
    const c = card({ answer: "", front: "Keep it simple.", kind: "reminder" });
    const update = {
      card: c,
      newHash: computeCardHash(c),
      nid: NID,
      oldHash: "oldhash",
    };
    const confirm = vi.fn();
    const result = await reconcileExistingCards({
      cards: [c],
      client: gateway({
        cardsInfo: vi.fn(async () => [
          { cardId: 91, deckName: "Default", note: NID },
        ]),
        notesInfo: vi.fn(async () => [
          {
            cards: [91],
            fields: {
              Prompt: { order: 0, value: "<p>Keep it simple.</p>" },
              Source: { order: 1, value: "old source" },
            },
            modelName: "Obsidian-spaced",
            noteId: NID,
            tags: [],
          },
        ]),
      }),
      confirmKindRecreations: confirm,
      frontmatter: frontmatter(c),
      plan: plan([update]),
    });

    expect(result.plan.update[0]).toEqual(
      expect.objectContaining({
        existing: expect.objectContaining({ modelName: "Obsidian-spaced" }),
      }),
    );
    expect(result.plan.update[0]!.recreate).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before a basic-to-cloze recreation and drops the update when declined", async () => {
    const c = card({ answer: "", front: "The ==answer==", kind: "cloze" });
    const update = {
      card: c,
      newHash: computeCardHash(c),
      nid: NID,
      oldHash: "oldhash",
    };
    const confirm = vi.fn(async () => false);
    const result = await reconcileExistingCards({
      cards: [c],
      client: gateway({
        cardsInfo: vi.fn(async () => [{ cardId: 91, deckName: "Default", note: NID }]),
        notesInfo: vi.fn(async () => [
          { cards: [91], modelName: "Obsidian-basic", noteId: NID, tags: [] },
        ]),
      }),
      confirmKindRecreations: confirm,
      frontmatter: frontmatter(c),
      plan: plan([update]),
    });

    expect(confirm).toHaveBeenCalledWith([
      expect.objectContaining({
        blockId: "q-aaaa",
        fromModel: "Obsidian-basic",
        nid: NID,
        toModel: "Obsidian-cloze",
      }),
    ]);
    expect(result.plan.update).toEqual([]);
  });

  it("marks a confirmed basic-to-cloze update for safe recreation", async () => {
    const c = card({ answer: "", front: "The ==answer==", kind: "cloze" });
    const update = {
      card: c,
      newHash: computeCardHash(c),
      nid: NID,
      oldHash: "oldhash",
    };
    const result = await reconcileExistingCards({
      cards: [c],
      client: gateway({
        cardsInfo: vi.fn(async () => [{ cardId: 91, deckName: "Default", note: NID }]),
        notesInfo: vi.fn(async () => [
          { cards: [91], modelName: "Obsidian-basic", noteId: NID, tags: [] },
        ]),
      }),
      confirmKindRecreations: vi.fn(async () => true),
      frontmatter: frontmatter(c),
      plan: plan([update]),
    });

    expect(result.plan.update[0]!.recreate).toBe(true);
  });
});

describe("syncNote — stale nid recovery", () => {
  it("recreates the card, replaces its frontmatter nid, and reports the recovery", async () => {
    const c = card();
    const hash = computeCardHash(c);
    const markdown = [
      "---",
      "flashcards:",
      `  q-aaaa: { nid: ${NID}, hash: ${hash} }`,
      "---",
      "Q::A ^q-aaaa",
      "",
    ].join("\n");
    let saved = markdown;
    const addNote = vi.fn(async () => 1_788_437_399_999);
    const client = gateway({
      addNote,
      cardsInfo: vi.fn(async () => []),
      createDeck: vi.fn(async () => 1),
      createModel: vi.fn(async () => null),
      deckNames: vi.fn(async () => ["Default"]),
      deleteNotes: vi.fn(async () => undefined),
      modelFieldAdd: vi.fn(async () => undefined),
      modelFieldNames: vi.fn(async (name: string) =>
        name.endsWith("cloze")
          ? ["Text", "Extra", "Context", "Source"]
          : ["Front", "Back", "Context", "Source"],
      ),
      modelNames: vi.fn(async () => [
        "Obsidian-basic",
        "Obsidian-basic-reversed",
        "Obsidian-cloze",
      ]),
      notesInfo: vi.fn(async () => [{}]),
      updateModelTemplates: vi.fn(async () => undefined),
    });
    const note: MarkdownNote = {
      file: {},
      markdown,
      name: "stale",
      path: "stale.md",
    };

    const result = await syncNote({
      ankiClient: client,
      note,
      repository: {
        getActiveNote: vi.fn(async () => note),
        getAllMarkdownNotes: vi.fn(async () => [note]),
        saveNote: vi.fn(async (_note, next) => {
          saved = next;
        }),
      },
      settings: { ...DEFAULT_SETTINGS, folderBasedDecks: false },
      vaultName: "Vault",
    });

    expect(result.status).toBe("ok");
    expect(result.recoveredMissingCount).toBe(1);
    expect(addNote).toHaveBeenCalledTimes(1);
    expect(saved).toContain("nid: 1788437399999");
    expect(saved).not.toContain(`nid: ${NID}`);
  });
});
