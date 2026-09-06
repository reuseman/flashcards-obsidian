import type {
  AnkiCardInfo,
  AnkiGateway,
  AnkiNoteInfo,
} from "../../application/ports.js";
import type {
  AnkiAddNoteParams,
  AnkiCreateModelSpec,
} from "../../core/sync/anki-contract.js";

const ANKI_CONNECT_VERSION = 6;
const DEFAULT_ENDPOINT = "http://127.0.0.1:8765";

export interface AnkiConnectClientOptions {
  endpoint?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  transport?: AnkiConnectTransport;
}

export interface AnkiConnectTransportResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

/** HTTP seam used by Obsidian to avoid Electron's browser CORS restrictions. */
export type AnkiConnectTransport = (
  endpoint: string,
  envelope: Record<string, unknown>,
) => Promise<AnkiConnectTransportResponse>;

export type AnkiModelTemplates = Record<
  string,
  { Back: string; Front: string }
>;

export interface AnkiModelStyling {
  css: string;
}

export interface AnkiRequest {
  action: string;
  params?: Record<string, unknown>;
}

export interface AnkiResponse<TResult> {
  error: string | null;
  result: TResult;
}

export class AnkiConnectClient implements AnkiGateway {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly transport: AnkiConnectTransport;

  constructor(opts: AnkiConnectClientOptions = {}) {
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.apiKey = opts.apiKey;
    const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.transport =
      opts.transport ??
      (async (endpoint, envelope) => {
        return fetchImpl(endpoint, {
          body: JSON.stringify(envelope),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
      });
  }

  async invoke<TResult>(request: AnkiRequest): Promise<TResult> {
    const envelope: Record<string, unknown> = {
      action: request.action,
      version: ANKI_CONNECT_VERSION,
      params: request.params ?? {},
    };
    if (this.apiKey !== undefined) {
      envelope.key = this.apiKey;
    }

    const response = await this.transport(this.endpoint, envelope);

    if (!response.ok) {
      throw new Error(`AnkiConnect HTTP ${response.status}`);
    }

    const payload = (await response.json()) as AnkiResponse<TResult>;
    if (payload.error !== null) {
      throw new Error(payload.error);
    }
    return payload.result;
  }

  version(): Promise<number> {
    return this.invoke<number>({ action: "version" });
  }

  deckNames(): Promise<string[]> {
    return this.invoke<string[]>({ action: "deckNames" });
  }

  createDeck(name: string): Promise<number> {
    return this.invoke<number>({
      action: "createDeck",
      params: { deck: name },
    });
  }

  modelNames(): Promise<string[]> {
    return this.invoke<string[]>({ action: "modelNames" });
  }

  createModel(spec: AnkiCreateModelSpec): Promise<unknown> {
    return this.invoke<unknown>({
      action: "createModel",
      params: spec as unknown as Record<string, unknown>,
    });
  }

  modelFieldNames(modelName: string): Promise<string[]> {
    return this.invoke<string[]>({
      action: "modelFieldNames",
      params: { modelName },
    });
  }

  modelTemplates(modelName: string): Promise<AnkiModelTemplates> {
    return this.invoke<AnkiModelTemplates>({
      action: "modelTemplates",
      params: { modelName },
    });
  }

  modelStyling(modelName: string): Promise<AnkiModelStyling> {
    return this.invoke<AnkiModelStyling>({
      action: "modelStyling",
      params: { modelName },
    });
  }

  async modelFieldAdd(
    modelName: string,
    fieldName: string,
    index: number,
  ): Promise<void> {
    await this.invoke<null>({
      action: "modelFieldAdd",
      params: { modelName, fieldName, index },
    });
  }

  async updateModelTemplates(
    modelName: string,
    templates: Record<string, { Front: string; Back: string }>,
  ): Promise<void> {
    await this.invoke<null>({
      action: "updateModelTemplates",
      params: { model: { name: modelName, templates } },
    });
  }

  async updateModelStyling(modelName: string, css: string): Promise<void> {
    await this.invoke<null>({
      action: "updateModelStyling",
      params: { model: { name: modelName, css } },
    });
  }

  addNote(note: AnkiAddNoteParams): Promise<number | null> {
    return this.invoke<number | null>({
      action: "addNote",
      params: { note },
    });
  }

  async addTags(nids: number[], tags: string[]): Promise<void> {
    await this.invoke<null>({
      action: "addTags",
      params: { notes: nids, tags: tags.join(" ") },
    });
  }

  cardsInfo(cardIds: number[]): Promise<AnkiCardInfo[]> {
    return this.invoke<AnkiCardInfo[]>({
      action: "cardsInfo",
      params: { cards: cardIds },
    });
  }

  async changeDeck(cardIds: number[], deckName: string): Promise<void> {
    await this.invoke<null>({
      action: "changeDeck",
      params: { cards: cardIds, deck: deckName },
    });
  }

  notesInfo(nids: number[]): Promise<AnkiNoteInfo[]> {
    return this.invoke<AnkiNoteInfo[]>({
      action: "notesInfo",
      params: { notes: nids },
    });
  }

  async removeTags(nids: number[], tags: string[]): Promise<void> {
    await this.invoke<null>({
      action: "removeTags",
      params: { notes: nids, tags: tags.join(" ") },
    });
  }

  async updateNoteFields(
    nid: number,
    fields: Record<string, string>,
  ): Promise<void> {
    await this.invoke<null>({
      action: "updateNoteFields",
      params: { note: { id: nid, fields } },
    });
  }

  async updateNoteModel(
    nid: number,
    modelName: string,
    fields: Record<string, string>,
    tags: string[],
  ): Promise<void> {
    await this.invoke<null>({
      action: "updateNoteModel",
      params: { note: { id: nid, modelName, fields, tags } },
    });
  }

  async deleteNotes(nids: number[]): Promise<void> {
    await this.invoke<null>({
      action: "deleteNotes",
      params: { notes: nids },
    });
  }

  /**
   * AnkiConnect's batch primitive. Each entry is invoked server-side and the
   * results are returned in order. Used by `uploadMedia` to ship N
   * `storeMediaFile` calls in a single HTTP round-trip.
   */
  multi(actions: AnkiRequest[]): Promise<unknown[]> {
    return this.invoke<unknown[]>({
      action: "multi",
      params: { actions },
    });
  }
}
