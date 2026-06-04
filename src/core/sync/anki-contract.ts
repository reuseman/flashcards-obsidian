/**
 * Plain DTO shapes describing the AnkiConnect wire contract.
 *
 * These live in `core/sync` (not in an adapter or the application port file) so
 * that pure modules which produce these shapes — notably `core/render/render-card.ts`
 * (`getAnkiModelSpecs`) — can reference them without `core` depending on
 * `application/` or `adapters/`. The `AnkiGateway` port (`application/ports.ts`)
 * and the concrete `AnkiConnectClient` (`adapters/anki`) both import them from
 * here (application→core and adapter→core are allowed directions).
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
