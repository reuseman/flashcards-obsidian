import type { AnkiConnectClient } from "../adapters/anki/anki-connect-client.js";
import {
  executeSyncPlan,
  type ExecuteSyncPlanResult,
} from "../adapters/anki/execute-sync-plan.js";
import type {
  MarkdownNote,
  ObsidianMarkdownRepository,
} from "../adapters/obsidian/obsidian-markdown-repository.js";
import type { FlashcardsSettings } from "../core/config/settings.js";
import { NoopLogger, type Logger } from "../core/logging/logger.js";
import { applyTextEdits } from "../core/edits/apply-text-edits.js";
import { computeCardHash } from "../core/edits/card-hash.js";
import { insertCardAnchors } from "../core/edits/insert-card-anchors.js";
import { writeCardFrontmatter } from "../core/edits/write-card-frontmatter.js";
import { writebackSyncResults } from "../core/edits/writeback-sync-results.js";
import { extractCardsFromMarkdown } from "../core/parse/extract-cards.js";
import { buildSyncPlan } from "../core/sync/build-sync-plan.js";
import { parseCardFrontmatter } from "../core/sync/parse-card-frontmatter.js";

export interface SyncNoteInput {
  ankiClient: AnkiConnectClient;
  generateBlockId?: () => string;
  logger?: Logger;
  note: MarkdownNote;
  repository: ObsidianMarkdownRepository;
  settings: FlashcardsSettings;
  vaultName: string;
}

export type SyncNoteStatus = "ok" | "skipped" | "failed";

export interface SyncNoteResult {
  ankiResults?: ExecuteSyncPlanResult;
  error?: string;
  identityWritesApplied: number;
  notePath: string;
  parsedCardCount: number;
  status: SyncNoteStatus;
  writebackEditsApplied: number;
}

const BLOCK_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * Default v2 blockId generator: 4 chars from the Crockford-style alphabet
 * (omits `l, o, 0, 1`). Uses Math.random — sufficient for collision
 * resistance within a single note, and avoids `crypto.getRandomValues`
 * test-environment fragility.
 */
function defaultGenerateBlockId(): string {
  let out = "q-";
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * BLOCK_ID_ALPHABET.length);
    out += BLOCK_ID_ALPHABET[idx];
  }
  return out;
}

export async function syncNote(input: SyncNoteInput): Promise<SyncNoteResult> {
  const {
    ankiClient,
    generateBlockId = defaultGenerateBlockId,
    note,
    repository,
    settings,
    vaultName,
  } = input;
  const logger: Logger = input.logger ?? new NoopLogger();

  logger.info("syncNote start", { notePath: note.path });

  // Phase A — local edits.
  const { cards } = extractCardsFromMarkdown(note.markdown, {
    notePath: note.path,
    settings,
  });

  if (cards.length === 0) {
    logger.debug("syncNote skipped (no flashcards parsed)", { notePath: note.path });
    return {
      identityWritesApplied: 0,
      notePath: note.path,
      parsedCardCount: 0,
      status: "skipped",
      writebackEditsApplied: 0,
    };
  }

  logger.debug("syncNote parsed cards", {
    notePath: note.path,
    parsedCardCount: cards.length,
  });

  const insert = insertCardAnchors({
    cards,
    generateBlockId,
    markdown: note.markdown,
  });
  const markdownA = applyTextEdits(note.markdown, insert.edits);

  const writeFm = writeCardFrontmatter({
    cards: insert.cards,
    markdown: markdownA,
  });
  const markdownB = applyTextEdits(markdownA, writeFm.edits);

  const identityWritesApplied = insert.edits.length + writeFm.edits.length;

  if (markdownB !== note.markdown) {
    await repository.saveNote(note, markdownB);
  }

  // Phase B — diff and sync.
  const frontmatter = parseCardFrontmatter(markdownB);
  const plan = buildSyncPlan({
    cards: insert.cards,
    computeHash: computeCardHash,
    frontmatter,
  });

  const empty =
    plan.create.length === 0 &&
    plan.update.length === 0 &&
    plan.delete.length === 0;

  if (empty) {
    logger.info("syncNote ok (no plan ops)", {
      notePath: note.path,
      identityWritesApplied,
    });
    return {
      identityWritesApplied,
      notePath: note.path,
      parsedCardCount: cards.length,
      status: "ok",
      writebackEditsApplied: 0,
    };
  }

  logger.debug("syncNote sync plan", {
    notePath: note.path,
    creates: plan.create.length,
    updates: plan.update.length,
    deletes: plan.delete.length,
  });

  let results: ExecuteSyncPlanResult;
  try {
    results = await executeSyncPlan({
      client: ankiClient,
      logger,
      notePath: note.path,
      plan,
      vaultName,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("syncNote failed in Phase B", { notePath: note.path, error: msg });
    return {
      error: msg,
      identityWritesApplied,
      notePath: note.path,
      parsedCardCount: cards.length,
      status: "failed",
      writebackEditsApplied: 0,
    };
  }

  const writeback = writebackSyncResults({ markdown: markdownB, results });
  const markdownC = applyTextEdits(markdownB, writeback.edits);

  if (markdownC !== markdownB) {
    await repository.saveNote(note, markdownC);
  }

  logger.info("syncNote ok", {
    notePath: note.path,
    okCreates: results.creates.filter((c) => c.status === "ok").length,
    okUpdates: results.updates.filter((u) => u.status === "ok").length,
    okDeletes: results.deletes.filter((d) => d.status === "ok").length,
    failedOps:
      results.creates.filter((c) => c.status === "failed").length +
      results.updates.filter((u) => u.status === "failed").length +
      results.deletes.filter((d) => d.status === "failed").length,
  });

  return {
    ankiResults: results,
    identityWritesApplied,
    notePath: note.path,
    parsedCardCount: cards.length,
    status: "ok",
    writebackEditsApplied: writeback.edits.length,
  };
}
