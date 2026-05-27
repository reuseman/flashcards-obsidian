import { describe, expect, it } from "vitest";
import { AnkiConnectClient } from "../../../src/adapters/anki/anki-connect-client.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REVERSED,
  getAnkiModelSpecs,
} from "../../../src/adapters/anki/render-card.js";
import { executeSyncPlan } from "../../../src/adapters/anki/execute-sync-plan.js";
import type {
  CreateOp,
  DeleteOp,
  SyncPlan,
  UpdateOp,
} from "../../../src/core/sync/sync-plan.js";
import type { IdentifiedFlashcard } from "../../../src/core/domain/card.js";

/**
 * Phase 6 slice 6c — sync plan executor.
 *
 * Module under test (does NOT yet exist):
 *   src/adapters/anki/execute-sync-plan.ts
 *
 * Locked decisions (do not relitigate):
 *   - Validate `card.deckName !== undefined` for every CREATE op BEFORE any
 *     network call. If any CREATE has undefined deckName → throw
 *     `"Card has no resolved deckName: <blockId>"`. No bootstrap, no ops.
 *   - Bootstrap order: models first (modelNames; for each present model,
 *     modelFieldNames; if Source missing, modelFieldAdd + updateModelTemplates;
 *     for each absent model, createModel), then decks (deckNames + createDeck
 *     for each unique missing deck from CREATEs, in first-occurrence order).
 *     If no CREATEs, deck bootstrap is skipped entirely (no deckNames call).
 *   - Per-op order: all CREATEs (plan order) → all UPDATEs → all DELETEs.
 *   - Sequential awaits; no Promise.all.
 *   - addNote returns null → failed with error "addNote returned null".
 *     Not expected at runtime (AnkiConnect throws on duplicates) but the
 *     branch is defensive against the Promise<number | null> type.
 *   - addNote/updateNoteFields/deleteNotes throw → failed with error.message.
 *     Subsequent ops continue.
 *   - DELETEs are one-by-one (NOT batched), even if multiple in plan.
 *   - Result indices align with plan op indices.
 *   - Bootstrap errors (modelNames/createModel/deckNames/createDeck throw):
 *     rejection bubbles up; per-op execution does not start.
 */

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface FakeResponseSpec {
  readonly body?: unknown;
  readonly ok?: boolean;
  readonly status?: number;
  readonly throws?: Error;
}

interface RecordedCall {
  readonly action: string;
  readonly params: Record<string, unknown>;
}

interface FakeFetchHandle {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: RecordedCall[];
}

function makeFakeFetch(responses: readonly FakeResponseSpec[]): FakeFetchHandle {
  const queue = [...responses];
  const calls: RecordedCall[] = [];

  const fakeFetch = (async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const rawBody = init?.body;
    const parsed =
      typeof rawBody === "string"
        ? (JSON.parse(rawBody) as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    calls.push({
      action: String(parsed.action),
      params: (parsed.params as Record<string, unknown>) ?? {},
    });

    const next = queue.shift();
    if (!next) throw new Error("FakeFetch: no queued response");
    if (next.throws) throw next.throws;

    const ok = next.ok ?? true;
    const status = next.status ?? (ok ? 200 : 500);
    return {
      json: async () => next.body,
      ok,
      status,
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;

  return { calls, fetch: fakeFetch };
}

function ok<T>(result: T): FakeResponseSpec {
  return { body: { error: null, result } };
}

function err(error: string): FakeResponseSpec {
  return { body: { error, result: null } };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCard(overrides: Partial<IdentifiedFlashcard> = {}): IdentifiedFlashcard {
  return {
    answer: "A",
    blockId: overrides.blockId ?? "blk1",
    deckName: "Default",
    front: "Q",
    kind: "basic",
    source: { endOffset: 10, line: 1, startOffset: 0, syntax: "inline" },
    tags: [],
    ...overrides,
  };
}

function createOp(card: IdentifiedFlashcard, hash = "h"): CreateOp {
  return { card, hash };
}

function updateOp(card: IdentifiedFlashcard, nid: number): UpdateOp {
  return { card, newHash: "new", nid, oldHash: "old" };
}

function deleteOp(blockId: string, nid: number): DeleteOp {
  return { blockId, nid };
}

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE];

// v2-shaped field lists returned by modelFieldNames for each required model.
// `Source` present means the extend-in-place upgrade is a no-op.
const V2_FIELDS: Record<string, string[]> = {
  [ANKI_MODEL_BASIC]: ["Front", "Back", "Source"],
  [ANKI_MODEL_REVERSED]: ["Front", "Back", "Source"],
  [ANKI_MODEL_CLOZE]: ["Text", "Extra", "Source"],
};

// Standard bootstrap when all 3 required models are already present AND already
// v2-shaped (have Source field). Sequence: modelNames, then modelFieldNames for
// each of the 3 models in REQUIRED_MODELS order.
function bootAllV2(): FakeResponseSpec[] {
  return [
    ok(ALL_MODELS),
    ok(V2_FIELDS[ANKI_MODEL_BASIC]),
    ok(V2_FIELDS[ANKI_MODEL_REVERSED]),
    ok(V2_FIELDS[ANKI_MODEL_CLOZE]),
  ];
}

// Action sequence emitted by `bootAllV2`.
const BOOT_ACTIONS_ALL_V2 = [
  "modelNames",
  "modelFieldNames",
  "modelFieldNames",
  "modelFieldNames",
];

const VAULT = "MyVault";
const NOTE_PATH = "folder/note.md";

function makeClient(fetch: typeof globalThis.fetch): AnkiConnectClient {
  return new AnkiConnectClient({ fetch });
}

function emptyPlan(overrides: Partial<SyncPlan> = {}): SyncPlan {
  return { create: [], delete: [], update: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Bootstrap — model presence
// ---------------------------------------------------------------------------

describe("executeSyncPlan — bootstrap models", () => {
  it("probes fields (no createModel, no extend) when all 3 are present and v2-shaped", async () => {
    const { calls, fetch } = makeFakeFetch(bootAllV2());
    const client = makeClient(fetch);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan(),
      vaultName: VAULT,
    });

    expect(calls.map((c) => c.action)).toEqual(BOOT_ACTIONS_ALL_V2);
  });

  it("creates exactly the missing model (no field-probe for it) when 1 of 3 is absent", async () => {
    const { calls, fetch } = makeFakeFetch([
      ok([ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED]),
      ok(V2_FIELDS[ANKI_MODEL_BASIC]),
      ok(V2_FIELDS[ANKI_MODEL_REVERSED]),
      ok({ id: 1 }), // createModel for cloze
    ]);
    const client = makeClient(fetch);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan(),
      vaultName: VAULT,
    });

    expect(calls.map((c) => c.action)).toEqual([
      "modelNames",
      "modelFieldNames",
      "modelFieldNames",
      "createModel",
    ]);

    const expectedSpec = getAnkiModelSpecs().find(
      (s) => s.modelName === ANKI_MODEL_CLOZE,
    );
    expect(calls[3]!.params).toEqual(expectedSpec);
  });

  it("creates all 3 models when none are present (no field probes)", async () => {
    const { calls, fetch } = makeFakeFetch([
      ok([]),
      ok({ id: 1 }),
      ok({ id: 2 }),
      ok({ id: 3 }),
    ]);
    const client = makeClient(fetch);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan(),
      vaultName: VAULT,
    });

    expect(calls.map((c) => c.action)).toEqual([
      "modelNames",
      "createModel",
      "createModel",
      "createModel",
    ]);
    const createdNames = calls
      .slice(1)
      .map((c) => (c.params as { modelName: string }).modelName);
    expect(new Set(createdNames)).toEqual(new Set(ALL_MODELS));
  });

  // Extend-in-place: a v1 model is present but lacks the `Source` field.
  // The bootstrap must add the field, then rewrite card templates so
  // {{Source}} actually renders. CSS is intentionally left alone.
  it("extends a v1-shaped model in-place (modelFieldAdd + updateModelTemplates) when Source is missing", async () => {
    // Order is per-model interleaved: probe basic → extend basic → probe reversed → probe cloze.
    const { calls, fetch } = makeFakeFetch([
      ok(ALL_MODELS),
      ok(["Front", "Back"]), // basic — v1 shape, no Source
      ok(null), // modelFieldAdd basic
      ok(null), // updateModelTemplates basic
      ok(V2_FIELDS[ANKI_MODEL_REVERSED]),
      ok(V2_FIELDS[ANKI_MODEL_CLOZE]),
    ]);
    const client = makeClient(fetch);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan(),
      vaultName: VAULT,
    });

    expect(calls.map((c) => c.action)).toEqual([
      "modelNames",
      "modelFieldNames",
      "modelFieldAdd",
      "updateModelTemplates",
      "modelFieldNames",
      "modelFieldNames",
    ]);
    expect(calls[2]!.params).toEqual({
      modelName: ANKI_MODEL_BASIC,
      fieldName: "Source",
      index: 2,
    });
    const updParams = calls[3]!.params as {
      model: { name: string; templates: Record<string, { Front: string; Back: string }> };
    };
    expect(updParams.model.name).toBe(ANKI_MODEL_BASIC);
    expect(updParams.model.templates["Card 1"]!.Back).toContain("{{Source}}");
  });

  it("extends all 3 v1-shaped models when none of them have Source", async () => {
    const { calls, fetch } = makeFakeFetch([
      ok(ALL_MODELS),
      ok(["Front", "Back"]), // basic
      ok(null), ok(null),    // extend basic
      ok(["Front", "Back"]), // reversed
      ok(null), ok(null),    // extend reversed
      ok(["Text", "Extra"]), // cloze
      ok(null), ok(null),    // extend cloze
    ]);
    const client = makeClient(fetch);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan(),
      vaultName: VAULT,
    });

    expect(calls.map((c) => c.action)).toEqual([
      "modelNames",
      "modelFieldNames",
      "modelFieldAdd",
      "updateModelTemplates",
      "modelFieldNames",
      "modelFieldAdd",
      "updateModelTemplates",
      "modelFieldNames",
      "modelFieldAdd",
      "updateModelTemplates",
    ]);
    expect((calls[8]!.params as { modelName: string }).modelName).toBe(
      ANKI_MODEL_CLOZE,
    );
  });
});

// ---------------------------------------------------------------------------
// Bootstrap — deck presence
// ---------------------------------------------------------------------------

describe("executeSyncPlan — bootstrap decks", () => {
  it("skips deck bootstrap entirely when plan has no CREATE ops", async () => {
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(null), // updateNoteFields
    ]);
    const client = makeClient(fetch);
    const u = updateOp(makeCard(), 100);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ update: [u] }),
      vaultName: VAULT,
    });

    expect(calls.map((c) => c.action)).toEqual([
      ...BOOT_ACTIONS_ALL_V2,
      "updateNoteFields",
    ]);
  });

  it("calls no createDeck when all CREATE deckNames already exist", async () => {
    const c = createOp(makeCard({ blockId: "b1", deckName: "Default" }));
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(["Default", "Other"]),
      ok(7777), // addNote
    ]);
    const client = makeClient(fetch);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ create: [c] }),
      vaultName: VAULT,
    });

    expect(calls.map((c) => c.action)).toEqual([
      ...BOOT_ACTIONS_ALL_V2,
      "deckNames",
      "addNote",
    ]);
  });

  it("calls createDeck for each missing deck in first-occurrence order", async () => {
    const c1 = createOp(makeCard({ blockId: "b1", deckName: "Foo" }));
    const c2 = createOp(makeCard({ blockId: "b2", deckName: "Bar" }));
    const c3 = createOp(makeCard({ blockId: "b3", deckName: "Existing" }));
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(["Existing"]),
      ok(1), // createDeck Foo
      ok(2), // createDeck Bar
      ok(11), // addNote b1
      ok(12), // addNote b2
      ok(13), // addNote b3
    ]);
    const client = makeClient(fetch);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ create: [c1, c2, c3] }),
      vaultName: VAULT,
    });

    const actions = calls.map((c) => c.action);
    expect(actions).toEqual([
      ...BOOT_ACTIONS_ALL_V2,
      "deckNames",
      "createDeck",
      "createDeck",
      "addNote",
      "addNote",
      "addNote",
    ]);
    const createDeckCalls = calls.filter((c) => c.action === "createDeck");
    expect(createDeckCalls[0]!.params).toEqual({ deck: "Foo" });
    expect(createDeckCalls[1]!.params).toEqual({ deck: "Bar" });
  });

  it("calls createDeck at most once per unique deck name even with duplicates", async () => {
    const c1 = createOp(makeCard({ blockId: "b1", deckName: "Foo" }));
    const c2 = createOp(makeCard({ blockId: "b2", deckName: "Foo" }));
    const c3 = createOp(makeCard({ blockId: "b3", deckName: "Foo" }));
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok([]),
      ok(1), // createDeck Foo (once)
      ok(11),
      ok(12),
      ok(13),
    ]);
    const client = makeClient(fetch);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ create: [c1, c2, c3] }),
      vaultName: VAULT,
    });

    const createDeckCalls = calls.filter((c) => c.action === "createDeck");
    expect(createDeckCalls).toHaveLength(1);
    expect(createDeckCalls[0]!.params).toEqual({ deck: "Foo" });
  });

  it("throws synchronously-before-any-network-call when a CREATE card has no deckName", async () => {
    const card = makeCard({ blockId: "missing" });
    // Force undefined past exactOptionalPropertyTypes: the parser shouldn't
    // ever produce this, but executor must defensively validate.
    delete (card as { deckName?: string }).deckName;
    const c = createOp(card);
    const { calls, fetch } = makeFakeFetch([]); // no responses queued
    const client = makeClient(fetch);

    await expect(
      executeSyncPlan({
        client,
        notePath: NOTE_PATH,
        plan: emptyPlan({ create: [c] }),
        vaultName: VAULT,
      }),
    ).rejects.toThrow("Card has no resolved deckName: missing");

    // Locked: validation runs BEFORE bootstrap; no network calls.
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bootstrap network failures
// ---------------------------------------------------------------------------

describe("executeSyncPlan — bootstrap failures bubble up", () => {
  it("rejects when modelNames throws; no further calls", async () => {
    const { calls, fetch } = makeFakeFetch([err("anki down")]);
    const client = makeClient(fetch);

    await expect(
      executeSyncPlan({
        client,
        notePath: NOTE_PATH,
        plan: emptyPlan(),
        vaultName: VAULT,
      }),
    ).rejects.toThrow("anki down");

    expect(calls.map((c) => c.action)).toEqual(["modelNames"]);
  });

  it("rejects when createDeck throws after some succeed", async () => {
    const c1 = createOp(makeCard({ blockId: "b1", deckName: "Foo" }));
    const c2 = createOp(makeCard({ blockId: "b2", deckName: "Bar" }));
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok([]),
      ok(1), // createDeck Foo ok
      err("permission denied"), // createDeck Bar fails
    ]);
    const client = makeClient(fetch);

    await expect(
      executeSyncPlan({
        client,
        notePath: NOTE_PATH,
        plan: emptyPlan({ create: [c1, c2] }),
        vaultName: VAULT,
      }),
    ).rejects.toThrow("permission denied");

    expect(calls.map((c) => c.action)).toEqual([
      ...BOOT_ACTIONS_ALL_V2,
      "deckNames",
      "createDeck",
      "createDeck",
    ]);
  });
});

// ---------------------------------------------------------------------------
// CREATE per-op
// ---------------------------------------------------------------------------

describe("executeSyncPlan — CREATE ops", () => {
  it("addNote success returns ok result with nid", async () => {
    const card = makeCard({
      answer: "Paris",
      blockId: "b1",
      deckName: "Geo",
      front: "Capital of France?",
      tags: ["geography"],
    });
    const c = createOp(card);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(["Geo"]),
      ok(1714),
    ]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ create: [c] }),
      vaultName: VAULT,
    });

    expect(result.creates).toHaveLength(1);
    expect(result.creates[0]!.status).toBe("ok");
    expect(result.creates[0]!.nid).toBe(1714);
    expect(result.creates[0]!.op).toBe(c);

    const addCall = calls.find((c) => c.action === "addNote")!;
    const noteParam = (addCall.params as { note: Record<string, unknown> }).note;
    expect(noteParam.deckName).toBe("Geo");
    expect(noteParam.modelName).toBe(ANKI_MODEL_BASIC);
    expect(noteParam.tags).toEqual(["geography"]);
    expect((noteParam.fields as Record<string, string>).Front).toContain("Capital");
  });

  it("addNote returning null → failed with exact duplicate error message; no nid", async () => {
    const c = createOp(makeCard({ blockId: "dup" }));
    const { fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(["Default"]),
      { body: { error: null, result: null } }, // addNote returns null
    ]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ create: [c] }),
      vaultName: VAULT,
    });

    expect(result.creates[0]!.status).toBe("failed");
    expect(result.creates[0]!.error).toBe("addNote returned null");
    expect(result.creates[0]!.nid).toBeUndefined();
  });

  it("addNote throws → failed with error.message preserved", async () => {
    const c = createOp(makeCard({ blockId: "b1" }));
    const { fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(["Default"]),
      err("model was not found"),
    ]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ create: [c] }),
      vaultName: VAULT,
    });

    expect(result.creates[0]!.status).toBe("failed");
    expect(result.creates[0]!.error).toBe("model was not found");
    expect(result.creates[0]!.nid).toBeUndefined();
  });

  it("isolates per-op failures: first CREATE fails, second succeeds", async () => {
    const c1 = createOp(makeCard({ blockId: "b1" }));
    const c2 = createOp(makeCard({ blockId: "b2" }));
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(["Default"]),
      err("boom"),
      ok(222),
    ]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ create: [c1, c2] }),
      vaultName: VAULT,
    });

    expect(result.creates).toHaveLength(2);
    expect(result.creates[0]!.status).toBe("failed");
    expect(result.creates[0]!.error).toBe("boom");
    expect(result.creates[1]!.status).toBe("ok");
    expect(result.creates[1]!.nid).toBe(222);
    expect(calls.filter((c) => c.action === "addNote")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// UPDATE per-op
// ---------------------------------------------------------------------------

describe("executeSyncPlan — UPDATE ops", () => {
  it("updateNoteFields success → ok; called with (nid, rendered.fields)", async () => {
    const card = makeCard({ blockId: "b1", front: "Q1" });
    const u = updateOp(card, 555);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(null), // updateNoteFields
    ]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ update: [u] }),
      vaultName: VAULT,
    });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.status).toBe("ok");
    expect(result.updates[0]!.op).toBe(u);

    const upCall = calls.find((c) => c.action === "updateNoteFields")!;
    const noteParam = (upCall.params as {
      note: { id: number; fields: Record<string, string> };
    }).note;
    expect(noteParam.id).toBe(555);
    expect(noteParam.fields.Front).toContain("Q1");
  });

  it("updateNoteFields throws → failed with error.message", async () => {
    const u = updateOp(makeCard(), 999);
    const { fetch } = makeFakeFetch([...bootAllV2(), err("note not found")]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ update: [u] }),
      vaultName: VAULT,
    });

    expect(result.updates[0]!.status).toBe("failed");
    expect(result.updates[0]!.error).toBe("note not found");
  });

  it("two UPDATEs with mixed outcomes — both reported in plan order", async () => {
    const u1 = updateOp(makeCard({ blockId: "b1" }), 1);
    const u2 = updateOp(makeCard({ blockId: "b2" }), 2);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(),
      err("first failed"),
      ok(null),
    ]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ update: [u1, u2] }),
      vaultName: VAULT,
    });

    expect(result.updates[0]!.status).toBe("failed");
    expect(result.updates[0]!.error).toBe("first failed");
    expect(result.updates[1]!.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// DELETE per-op
// ---------------------------------------------------------------------------

describe("executeSyncPlan — DELETE ops", () => {
  it("deleteNotes called with [op.nid]; status ok", async () => {
    const d = deleteOp("b1", 777);
    const { calls, fetch } = makeFakeFetch([...bootAllV2(), ok(null)]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ delete: [d] }),
      vaultName: VAULT,
    });

    expect(result.deletes).toHaveLength(1);
    expect(result.deletes[0]!.status).toBe("ok");
    expect(result.deletes[0]!.op).toBe(d);

    const delCall = calls.find((c) => c.action === "deleteNotes")!;
    expect(delCall.params).toEqual({ notes: [777] });
  });

  it("deleteNotes throws → failed with error.message", async () => {
    const d = deleteOp("b1", 777);
    const { fetch } = makeFakeFetch([...bootAllV2(), err("nope")]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ delete: [d] }),
      vaultName: VAULT,
    });

    expect(result.deletes[0]!.status).toBe("failed");
    expect(result.deletes[0]!.error).toBe("nope");
  });

  it("multiple DELETEs are one-call-per-op (NOT batched)", async () => {
    const d1 = deleteOp("b1", 1);
    const d2 = deleteOp("b2", 2);
    const d3 = deleteOp("b3", 3);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(null),
      ok(null),
      ok(null),
    ]);
    const client = makeClient(fetch);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: emptyPlan({ delete: [d1, d2, d3] }),
      vaultName: VAULT,
    });

    const delCalls = calls.filter((c) => c.action === "deleteNotes");
    expect(delCalls).toHaveLength(3);
    expect(delCalls.map((c) => c.params)).toEqual([
      { notes: [1] },
      { notes: [2] },
      { notes: [3] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe("executeSyncPlan — ordering", () => {
  it("bootstrap → all addNotes → all updateNoteFields → all deleteNotes", async () => {
    const c1 = createOp(makeCard({ blockId: "c1" }));
    const c2 = createOp(makeCard({ blockId: "c2" }));
    const u1 = updateOp(makeCard({ blockId: "u1" }), 10);
    const d1 = deleteOp("d1", 99);

    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(["Default"]),
      ok(101), // addNote c1
      ok(102), // addNote c2
      ok(null), // updateNoteFields u1
      ok(null), // deleteNotes d1
    ]);
    const client = makeClient(fetch);

    await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: { create: [c1, c2], delete: [d1], update: [u1] },
      vaultName: VAULT,
    });

    expect(calls.map((c) => c.action)).toEqual([
      ...BOOT_ACTIONS_ALL_V2,
      "deckNames",
      "addNote",
      "addNote",
      "updateNoteFields",
      "deleteNotes",
    ]);
  });

  it("result arrays align by index with plan op arrays", async () => {
    const c1 = createOp(makeCard({ blockId: "c1" }));
    const c2 = createOp(makeCard({ blockId: "c2" }));
    const u1 = updateOp(makeCard({ blockId: "u1" }), 10);
    const u2 = updateOp(makeCard({ blockId: "u2" }), 11);
    const d1 = deleteOp("d1", 99);
    const d2 = deleteOp("d2", 100);

    const { fetch } = makeFakeFetch([
      ...bootAllV2(),
      ok(["Default"]),
      ok(201),
      ok(202),
      ok(null),
      ok(null),
      ok(null),
      ok(null),
    ]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: { create: [c1, c2], delete: [d1, d2], update: [u1, u2] },
      vaultName: VAULT,
    });

    expect(result.creates[0]!.op).toBe(c1);
    expect(result.creates[1]!.op).toBe(c2);
    expect(result.updates[0]!.op).toBe(u1);
    expect(result.updates[1]!.op).toBe(u2);
    expect(result.deletes[0]!.op).toBe(d1);
    expect(result.deletes[1]!.op).toBe(d2);
  });
});

// ---------------------------------------------------------------------------
// Integration smoke
// ---------------------------------------------------------------------------

describe("executeSyncPlan — integration smoke", () => {
  it("end-to-end with 1 missing model, 1 missing deck, and one of each op", async () => {
    const c = createOp(makeCard({ blockId: "c1", deckName: "NewDeck" }));
    const u = updateOp(makeCard({ blockId: "u1" }), 50);
    const d = deleteOp("d1", 51);

    const { calls, fetch } = makeFakeFetch([
      ok([ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED]), // cloze missing
      ok(V2_FIELDS[ANKI_MODEL_BASIC]),
      ok(V2_FIELDS[ANKI_MODEL_REVERSED]),
      ok({ id: 9 }), // createModel cloze
      ok(["Existing"]), // NewDeck missing
      ok(1), // createDeck NewDeck
      ok(7001), // addNote c1
      ok(null), // updateNoteFields u1
      ok(null), // deleteNotes d1
    ]);
    const client = makeClient(fetch);

    const result = await executeSyncPlan({
      client,
      notePath: NOTE_PATH,
      plan: { create: [c], delete: [d], update: [u] },
      vaultName: VAULT,
    });

    expect(calls.map((c) => c.action)).toEqual([
      "modelNames",
      "modelFieldNames",
      "modelFieldNames",
      "createModel",
      "deckNames",
      "createDeck",
      "addNote",
      "updateNoteFields",
      "deleteNotes",
    ]);
    expect(result.creates[0]!.status).toBe("ok");
    expect(result.creates[0]!.nid).toBe(7001);
    expect(result.updates[0]!.status).toBe("ok");
    expect(result.deletes[0]!.status).toBe("ok");
  });
});
