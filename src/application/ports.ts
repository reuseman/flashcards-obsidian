/**
 * Application-layer ports (hexagonal boundary).
 *
 * These interfaces describe the I/O the use cases in `application/` depend on,
 * without referencing any concrete adapter or framework (no `obsidian`, no
 * AnkiConnect transport). Adapters in `adapters/` implement them; the plugin
 * composition root wires concrete instances in.
 *
 * Keeping these here (rather than in `adapters/`) is what lets `application/`
 * satisfy the `application-no-adapters` / `application-no-obsidian` arch rules.
 */

// --- Markdown repository ---------------------------------------------------

/**
 * A markdown note as the application sees it. `file` is an opaque handle owned
 * by the adapter (in the Obsidian adapter it is a `TFile`); the application
 * never inspects it, it only threads it back through `saveNote`. Typed as
 * `unknown` so this port stays framework-free.
 */
export interface MarkdownNote {
  markdown: string;
  name: string;
  path: string;
  file: unknown;
}

export interface MarkdownRepository {
  getAllMarkdownNotes(): Promise<MarkdownNote[]>;
  getActiveNote(): Promise<MarkdownNote | null>;
  saveNote(note: MarkdownNote, markdown: string): Promise<void>;
}

// --- Anki gateway ----------------------------------------------------------

/**
 * Plain DTO shapes describing the AnkiConnect wire contract. Defined here (not
 * in the adapter) so the gateway port has no adapter dependency; the concrete
 * `AnkiConnectClient` and `render-card` import these back from the port.
 */
export interface AnkiCreateModelSpec {
  modelName: string;
  inOrderFields: string[];
  cardTemplates: Array<{ Name?: string; Front: string; Back: string }>;
  isCloze?: boolean;
  css?: string;
}

export interface AnkiAddNoteParams {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags?: string[];
  options?: { allowDuplicate?: boolean; duplicateScope?: string };
}

/**
 * The subset of AnkiConnect operations consumed by `executeSyncPlan`. Method
 * signatures mirror `AnkiConnectClient` exactly so the concrete client can
 * `implements AnkiGateway` without adaptation.
 */
export interface AnkiGateway {
  modelNames(): Promise<string[]>;
  createModel(spec: AnkiCreateModelSpec): Promise<unknown>;
  modelFieldNames(modelName: string): Promise<string[]>;
  modelFieldAdd(
    modelName: string,
    fieldName: string,
    index: number,
  ): Promise<void>;
  updateModelTemplates(
    modelName: string,
    templates: Record<string, { Front: string; Back: string }>,
  ): Promise<void>;
  deckNames(): Promise<string[]>;
  createDeck(name: string): Promise<number>;
  addNote(note: AnkiAddNoteParams): Promise<number | null>;
  updateNoteFields(nid: number, fields: Record<string, string>): Promise<void>;
  deleteNotes(nids: number[]): Promise<void>;
}
