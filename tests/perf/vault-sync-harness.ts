import type {
  AnkiCardInfo,
  AnkiGateway,
  AnkiNoteInfo,
  MarkdownNote,
  MarkdownRepository,
} from "../../src/application/ports.js";
import { syncVault, type SyncVaultResult } from "../../src/application/sync-vault.js";
import { prepareIncrementalVaultSync } from "../../src/adapters/obsidian/incremental-vault-sync.js";
import { DEFAULT_SETTINGS, type FlashcardsSettings } from "../../src/core/config/settings.js";
import { computeCardHash, computeRenderedFieldsHash } from "../../src/core/edits/card-hash.js";
import type { Logger } from "../../src/core/logging/logger.js";
import { previewSyncPlan } from "../../src/application/preview-sync-plan.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
  ANKI_MODEL_REVERSED,
  renderCardForAnki,
} from "../../src/core/render/render-card.js";
import type { AnkiAddNoteParams, AnkiCreateModelSpec } from "../../src/core/sync/anki-contract.js";

export type VaultSyncScenario = "cold" | "warm" | "source-change" | "anki-drift";

export interface VaultSyncMetrics {
  ankiReadItems: number;
  ankiRequests: number;
  ankiWriteActions: number;
  elapsedMs: number;
  markdownBytesRead: number;
  noteBodyReads: number;
  parseCalls: number;
  peakLoadedMarkdownBytes: number;
  renderCalls: number;
  result: SyncVaultResult;
  scanIndexBytes: number;
}

interface StoredNote {
  descriptor: {
    file: { path: string };
    mtime: number;
    name: string;
    path: string;
    size: number;
  };
  markdown: string;
}

interface StoredAnkiNote {
  cardId: number;
  deckName: string;
  fields: Record<string, string>;
  modelName: string;
  nid: number;
  tags: string[];
}

interface VaultTemplate {
  ankiNotes: StoredAnkiNote[];
  notes: Array<{ markdown: string; path: string }>;
}

const SETTINGS: FlashcardsSettings = {
  ...DEFAULT_SETTINGS,
  folderBasedDecks: false,
  logToFile: false,
  perfTracing: true,
};
const VAULT_NAME = "Synthetic benchmark vault";
const INDEX_PATH = ".obsidian/plugins/flashcards-obsidian/vault-scan-index.json";
const SETTINGS_KEY = "synthetic-v2-settings";
const BLOCK_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const MODEL_NAMES = [
  ANKI_MODEL_BASIC,
  ANKI_MODEL_REVERSED,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
];

function blockIdFor(index: number): string {
  let value = index;
  let suffix = "";
  for (let digit = 0; digit < 4; digit++) {
    suffix += BLOCK_ID_ALPHABET[value % BLOCK_ID_ALPHABET.length]!;
    value = Math.floor(value / BLOCK_ID_ALPHABET.length);
  }
  return `q-${suffix}`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Build once outside timed benchmark iterations. */
export function buildVaultTemplate(noteCount: number): VaultTemplate {
  const notes: VaultTemplate["notes"] = [];
  const ankiNotes: StoredAnkiNote[] = [];

  for (let index = 0; index < noteCount; index++) {
    const path = `benchmark/note-${String(index).padStart(5, "0")}.md`;
    const blockId = blockIdFor(index);
    const nid = 1_788_000_000_000 + index;
    const cardId = 2_788_000_000_000 + index;
    const body = `Question ${index}?:: Answer ${index}.\n^${blockId}\n`;
    const preview = previewSyncPlan({
      markdown: body,
      notePath: path,
      settings: SETTINGS,
    });
    const card = preview.identifiedCards[0];
    if (card === undefined || card.blockId !== blockId) {
      throw new Error(`Synthetic card ${index} did not retain ${blockId}`);
    }
    const rendered = renderCardForAnki(card, {
      deckName: card.deckName ?? SETTINGS.defaultDeck,
      highlightClozeEnabled: SETTINGS.highlightCloze.enabled,
      notePath: path,
      tags: card.tags,
      vaultName: VAULT_NAME,
    });
    const hash = computeCardHash(card);
    const sync = computeRenderedFieldsHash(rendered.fields);
    const markdown = [
      "---",
      "flashcards:",
      `  ${blockId}: { nid: ${nid}, hash: ${hash}, sync: ${sync} }`,
      "---",
      body,
    ].join("\n");

    notes.push({ markdown, path });
    ankiNotes.push({
      cardId,
      deckName: rendered.deckName,
      fields: { ...rendered.fields },
      modelName: rendered.modelName,
      nid,
      tags: [...rendered.tags],
    });
  }

  return { ankiNotes, notes };
}

class WorkLogger implements Logger {
  parseCalls = 0;
  renderCalls = 0;

  debug(message: string, data?: unknown): void {
    if (message === "syncNote start") this.parseCalls += 1;
    if (message === "syncNote parsed cards") {
      this.renderCalls += readNumber(data, "parsedCardCount");
    }
    if (message === "syncNote sync plan") {
      this.renderCalls += readNumber(data, "creates") + readNumber(data, "updates");
    }
  }

  info(message: string): void {
    if (message === "syncNote start") this.parseCalls += 1;
  }
  warn(): void {}
  error(): void {}
}

function readNumber(data: unknown, key: string): number {
  if (typeof data !== "object" || data === null) return 0;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

class CountingAnkiGateway implements AnkiGateway {
  ankiReadItems = 0;
  ankiRequests = 0;
  ankiWriteActions = 0;
  private nextNid = 1_789_000_000_000;
  private readonly notes = new Map<number, StoredAnkiNote>();

  constructor(seed: StoredAnkiNote[]) {
    for (const note of seed) {
      this.notes.set(note.nid, {
        ...note,
        fields: { ...note.fields },
        tags: [...note.tags],
      });
    }
  }

  resetMetrics(): void {
    this.ankiReadItems = 0;
    this.ankiRequests = 0;
    this.ankiWriteActions = 0;
  }

  drift(nids: number[]): void {
    for (const nid of nids) {
      const note = this.notes.get(nid);
      if (note === undefined) continue;
      const field = note.modelName === ANKI_MODEL_CLOZE ? "Text" : "Front";
      note.fields[field] = `<p>Manual Anki edit for ${nid}</p>`;
    }
  }

  async modelNames(): Promise<string[]> {
    this.ankiRequests++;
    return MODEL_NAMES;
  }

  async createModel(_spec: AnkiCreateModelSpec): Promise<unknown> {
    this.ankiRequests++;
    this.ankiWriteActions++;
    return null;
  }

  async modelFieldNames(modelName: string): Promise<string[]> {
    this.ankiRequests++;
    if (modelName === ANKI_MODEL_CLOZE) return ["Text", "Extra", "Context", "Source"];
    if (modelName === ANKI_MODEL_REMINDER) return ["Content", "Context", "Source"];
    return ["Front", "Back", "Context", "Source"];
  }

  async modelTemplates(): Promise<Record<string, { Back: string; Front: string }>> {
    this.ankiRequests++;
    return {};
  }

  async modelFieldAdd(): Promise<void> {
    this.ankiRequests++;
    this.ankiWriteActions++;
  }

  async updateModelTemplates(): Promise<void> {
    this.ankiRequests++;
    this.ankiWriteActions++;
  }

  async deckNames(): Promise<string[]> {
    this.ankiRequests++;
    return [SETTINGS.defaultDeck];
  }

  async createDeck(): Promise<number> {
    this.ankiRequests++;
    this.ankiWriteActions++;
    return 1;
  }

  async addNote(note: AnkiAddNoteParams): Promise<number> {
    this.ankiRequests++;
    this.ankiWriteActions++;
    const nid = this.nextNid++;
    this.notes.set(nid, {
      cardId: nid + 1_000_000,
      deckName: note.deckName,
      fields: { ...note.fields },
      modelName: note.modelName,
      nid,
      tags: [...(note.tags ?? [])],
    });
    return nid;
  }

  async addTags(nids: number[], tags: string[]): Promise<void> {
    this.ankiRequests++;
    this.ankiWriteActions++;
    for (const nid of nids) {
      const note = this.notes.get(nid);
      if (note) note.tags = [...new Set([...note.tags, ...tags])];
    }
  }

  async cardsInfo(cardIds: number[]): Promise<AnkiCardInfo[]> {
    this.ankiRequests++;
    this.ankiReadItems += cardIds.length;
    const wanted = new Set(cardIds);
    return [...this.notes.values()].flatMap((note) =>
      wanted.has(note.cardId)
        ? [{ cardId: note.cardId, deckName: note.deckName, note: note.nid }]
        : [],
    );
  }

  async changeDeck(cardIds: number[], deckName: string): Promise<void> {
    this.ankiRequests++;
    this.ankiWriteActions++;
    const wanted = new Set(cardIds);
    for (const note of this.notes.values()) {
      if (wanted.has(note.cardId)) note.deckName = deckName;
    }
  }

  async notesInfo(nids: number[]): Promise<AnkiNoteInfo[]> {
    this.ankiRequests++;
    this.ankiReadItems += nids.length;
    return nids.flatMap((nid) => {
      const note = this.notes.get(nid);
      return note === undefined
        ? []
        : [{
            cards: [note.cardId],
            fields: Object.fromEntries(
              Object.entries(note.fields).map(([name, value], order) => [
                name,
                { order, value },
              ]),
            ),
            modelName: note.modelName,
            noteId: note.nid,
            tags: [...note.tags],
          }];
    });
  }

  async removeTags(nids: number[], tags: string[]): Promise<void> {
    this.ankiRequests++;
    this.ankiWriteActions++;
    const removed = new Set(tags);
    for (const nid of nids) {
      const note = this.notes.get(nid);
      if (note) note.tags = note.tags.filter((tag) => !removed.has(tag));
    }
  }

  async updateNoteFields(nid: number, fields: Record<string, string>): Promise<void> {
    this.ankiRequests++;
    this.ankiWriteActions++;
    const note = this.notes.get(nid);
    if (note) note.fields = { ...fields };
  }

  async updateNoteModel(
    nid: number,
    modelName: string,
    fields: Record<string, string>,
    tags: string[],
  ): Promise<void> {
    this.ankiRequests++;
    this.ankiWriteActions++;
    const note = this.notes.get(nid);
    if (note) Object.assign(note, { fields: { ...fields }, modelName, tags: [...tags] });
  }

  async deleteNotes(nids: number[]): Promise<void> {
    this.ankiRequests++;
    this.ankiWriteActions++;
    for (const nid of nids) this.notes.delete(nid);
  }
}

class SyntheticRepository implements MarkdownRepository {
  markdownBytesRead = 0;
  noteBodyReads = 0;
  private readonly notes = new Map<string, StoredNote>();

  constructor(seed: VaultTemplate["notes"]) {
    for (const item of seed) {
      this.notes.set(item.path, {
        descriptor: {
          file: { path: item.path },
          mtime: 1,
          name: item.path.replace(/\.md$/, "").split("/").pop() ?? item.path,
          path: item.path,
          size: byteLength(item.markdown),
        },
        markdown: item.markdown,
      });
    }
  }

  resetMetrics(): void {
    this.markdownBytesRead = 0;
    this.noteBodyReads = 0;
  }

  changeAnswers(paths: string[]): void {
    for (const path of paths) {
      const stored = this.notes.get(path);
      if (stored === undefined) continue;
      const index = Number(/note-(\d+)\.md$/.exec(path)?.[1] ?? "0");
      stored.markdown = stored.markdown.replace(
        `Answer ${index}.`,
        `Changed answer ${index}.`,
      );
      stored.descriptor.mtime++;
      stored.descriptor.size = byteLength(stored.markdown);
    }
  }

  async listMarkdownNotes(): Promise<StoredNote["descriptor"][]> {
    return [...this.notes.values()].map((note) => note.descriptor);
  }

  async readMarkdownNote(descriptor: StoredNote["descriptor"]): Promise<MarkdownNote> {
    const stored = this.notes.get(descriptor.path)!;
    const bytes = byteLength(stored.markdown);
    this.noteBodyReads++;
    this.markdownBytesRead += bytes;
    return {
      file: descriptor.file,
      markdown: stored.markdown,
      name: descriptor.name,
      path: descriptor.path,
    };
  }

  async getAllMarkdownNotes(): Promise<MarkdownNote[]> {
    const descriptors = await this.listMarkdownNotes();
    return Promise.all(descriptors.map((descriptor) => this.readMarkdownNote(descriptor)));
  }

  async getActiveNote(): Promise<MarkdownNote | null> {
    const descriptor = (await this.listMarkdownNotes())[0];
    return descriptor === undefined ? null : this.readMarkdownNote(descriptor);
  }

  async saveNote(note: MarkdownNote, markdown: string): Promise<void> {
    const stored = this.notes.get(note.path);
    if (stored === undefined) throw new Error(`Unknown synthetic note: ${note.path}`);
    stored.markdown = markdown;
    stored.descriptor.mtime++;
    stored.descriptor.size = byteLength(markdown);
    note.markdown = markdown;
  }
}

class MemoryScanAdapter {
  readonly files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing scan file: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
}

export interface PreparedVaultSyncScenario {
  changedCardCount: number;
  run(): Promise<VaultSyncMetrics>;
}

class SyntheticVaultFixture {
  readonly anki: CountingAnkiGateway;
  readonly repository: SyntheticRepository;
  readonly scanAdapter = new MemoryScanAdapter();

  constructor(template: VaultTemplate) {
    this.anki = new CountingAnkiGateway(template.ankiNotes);
    this.repository = new SyntheticRepository(template.notes);
  }

  resetMetrics(): void {
    this.anki.resetMetrics();
    this.repository.resetMetrics();
  }

  async run(): Promise<VaultSyncMetrics> {
    const logger = new WorkLogger();
    let peakLoadedMarkdownBytes = 0;
    const startedAt = performance.now();
    const scan = await prepareIncrementalVaultSync({
      adapter: this.scanAdapter,
      ankiClient: this.anki,
      indexPath: INDEX_PATH,
      repository: this.repository,
      settingsKey: SETTINGS_KEY,
    });
    const result = await syncVault({
      ankiClient: this.anki,
      cachedAtomicCues: scan.cachedAtomicCues,
      logger,
      notes: scan.notes,
      onBatchLoaded: (_noteCount, markdownBytes) => {
        peakLoadedMarkdownBytes = Math.max(
          peakLoadedMarkdownBytes,
          markdownBytes,
        );
      },
      repository: this.repository,
      settings: SETTINGS,
      processedNoteCount: scan.processedNoteCount,
      skippedUnchangedNoteCount: scan.skippedUnchangedNoteCount,
      vaultName: VAULT_NAME,
    });
    await scan.finish(result.perNote);
    const elapsedMs = performance.now() - startedAt;

    return {
      ankiReadItems: this.anki.ankiReadItems,
      ankiRequests: this.anki.ankiRequests,
      ankiWriteActions: this.anki.ankiWriteActions,
      elapsedMs,
      markdownBytesRead: this.repository.markdownBytesRead,
      noteBodyReads: this.repository.noteBodyReads,
      parseCalls: logger.parseCalls,
      peakLoadedMarkdownBytes,
      renderCalls: logger.renderCalls,
      result,
      scanIndexBytes: byteLength(
        this.scanAdapter.files.get(INDEX_PATH) ?? "",
      ),
    };
  }
}

export async function prepareVaultSyncScenario(
  scenario: VaultSyncScenario,
  template: VaultTemplate,
): Promise<PreparedVaultSyncScenario> {
  const fixture = new SyntheticVaultFixture(template);
  const changedCardCount =
    scenario === "source-change" || scenario === "anki-drift"
      ? Math.max(1, Math.ceil(template.notes.length / 100))
      : 0;

  if (scenario !== "cold") {
    await fixture.run();
  }
  if (scenario === "source-change") {
    fixture.repository.changeAnswers(
      template.notes.slice(0, changedCardCount).map((note) => note.path),
    );
  }
  if (scenario === "anki-drift") {
    fixture.anki.drift(
      template.ankiNotes.slice(0, changedCardCount).map((note) => note.nid),
    );
  }
  fixture.resetMetrics();

  return {
    changedCardCount,
    run: () => fixture.run(),
  };
}
