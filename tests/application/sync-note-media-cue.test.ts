import { describe, expect, it } from "vitest";

import { syncNote } from "../../src/application/sync-note.js";
import { AnkiConnectClient } from "../../src/adapters/anki/anki-connect-client.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REVERSED,
} from "../../src/core/render/render-card.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import type { FlashcardsSettings } from "../../src/core/config/settings.js";
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

/**
 * Final-review fix #1 — media rewrite corrupts the stored atomic cue.
 *
 * `syncNote`'s media phase (src/application/sync-note.ts:314-327) rewrites
 * `op.card.front` in place (content-hashed image name) BEFORE the create hits
 * Anki. `writebackSyncResults` then computes the frontmatter `cue` from that
 * REWRITTEN front. The NEXT sync's `previewSyncPlan` computes the candidate
 * card's cue from the RAW extracted front (media rewrite happens later, in
 * `syncNote`'s own media phase, not in `previewSyncPlan`) — the two cues can
 * never match again, so every subsequent sync orphans the old entry and
 * creates a fresh one (WI-11's rebind pairing never even gets a chance,
 * since real production media pipelines produce a stable hash yielding a
 * DIFFERENT front text than the raw extraction every single time).
 *
 * Locked expectation: for an atomic cloze card whose first paragraph carries
 * a `==span==` AND an image embed, with a media pipeline wired, a SECOND
 * sync of the exact same note content must be a complete no-op — zero Anki
 * calls (no bootstrap chatter even), zero file writes.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE];
const VAULT = "MyVault";
const NOTE_PATH = "notes/Atomic media cloze.md";
const TITLE = "Atomic media cloze";

const FIRST_PARAGRAPH =
  "The ==mitochondria== is powered by ![[cell.png]] every single cycle.";

function fixture(): string {
  return ["---", "test: [cloze]", "---", "", FIRST_PARAGRAPH, ""].join("\n");
}

function settingsWith(
  overrides: Partial<FlashcardsSettings> = {},
): FlashcardsSettings {
  return { ...DEFAULT_SETTINGS, folderBasedDecks: false, ...overrides };
}

function makeNote(markdown: string): MarkdownNote {
  return {
    file: {} as MarkdownNote["file"],
    markdown,
    name: TITLE,
    path: NOTE_PATH,
  };
}

interface FakeRepoHandle {
  repository: ObsidianMarkdownRepository;
  saves: string[];
  currentMarkdown: () => string;
}

function makeFakeRepository(initial: string): FakeRepoHandle {
  let current = initial;
  const saves: string[] = [];
  const repo = {
    async getActiveNote() {
      return makeNote(current);
    },
    async saveNote(_note: MarkdownNote, markdown: string) {
      saves.push(markdown);
      current = markdown;
    },
  } as unknown as ObsidianMarkdownRepository;
  return { repository: repo, saves, currentMarkdown: () => current };
}

/**
 * Content-hashing fake media pipeline: mirrors what a real adapter does
 * (rewrite each ref's filename to a stable-but-DIFFERENT hashed name), which
 * is exactly the shape that corrupts the cue if `syncNote` computes it from
 * the rewritten front instead of the raw one.
 */
const mediaPipeline = async (
  refs: { filename: string; kind: "image" | "audio" }[],
) => ({
  rewriteMap: Object.fromEntries(
    refs.map((r) => [r.filename, { kind: r.kind, finalName: `sha1-${r.filename}` }]),
  ),
  errors: [],
});

describe("syncNote — media-rewrite cue corruption (atomic cloze + image)", () => {
  it("a second sync of an unchanged atomic cloze+image note is a complete no-op: zero Anki calls, zero file writes", async () => {
    const md = fixture();

    // --- First sync: establishes the entry + nid. ---------------------------
    const first = makeFakeRepository(md);
    const { fetch: fetch1 } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(55001), // addNote
    ]);
    const firstResult = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: fetch1 }),
      mediaPipeline,
      note: makeNote(md),
      repository: first.repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    expect(firstResult.status).toBe("ok");
    const inSync = first.currentMarkdown();

    // --- Second sync: SAME note content, SAME media pipeline. --------------
    // Enough fake responses to cover today's buggy orphan+create churn
    // without the fake-fetch queue itself throwing "no queued response" (a
    // compile/harness-level red, not the assertion we want).
    const second = makeFakeRepository(inSync);
    const { calls, fetch: fetch2 } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(55002), // addNote, if the churn bug fires
    ]);

    const secondResult = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: fetch2 }),
      mediaPipeline,
      note: makeNote(inSync),
      repository: second.repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(secondResult.status).toBe("ok");
    // The read-only notesInfo preflight checks that the stored nid is still
    // live. No model bootstrap or mutation is needed for an in-sync card.
    expect(calls.map((call) => call.action)).toEqual(["notesInfo"]);
    expect(second.saves).toHaveLength(0);
  });
});
