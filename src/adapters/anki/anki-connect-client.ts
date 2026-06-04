import type {
  AnkiAddNoteParams,
  AnkiCreateModelSpec,
  AnkiGateway,
} from "../../application/ports.js";

export type { AnkiAddNoteParams, AnkiCreateModelSpec };

const ANKI_CONNECT_VERSION = 6;
const DEFAULT_ENDPOINT = "http://127.0.0.1:8765";

export interface AnkiConnectClientOptions {
  endpoint?: string;
  apiKey?: string;
  fetch?: typeof fetch;
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
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnkiConnectClientOptions = {}) {
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.apiKey = opts.apiKey;
    // Bind `fetch` to its host object — when reassigned to a property and
    // called as `this.fetchImpl(...)`, browsers throw "Illegal invocation"
    // because `fetch` requires `this === window`. Tests inject their own
    // fetch (already bound to its closure), so this only matters at runtime.
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
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

    const response = await this.fetchImpl(this.endpoint, {
      body: JSON.stringify(envelope),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

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

  addNote(note: AnkiAddNoteParams): Promise<number | null> {
    return this.invoke<number | null>({
      action: "addNote",
      params: { note },
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
