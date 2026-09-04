/**
 * Shared fake `fetch` for AnkiConnect-shaped JSON-RPC tests.
 *
 * Mirrors the inline helpers previously duplicated in
 * `tests/adapters/anki/anki-connect-client.test.ts` and
 * `tests/adapters/anki/execute-sync-plan.test.ts`. Extracted here for the
 * application-level orchestration tests (slice 7a sync-note) to avoid a
 * third copy.
 */

export interface FakeResponseSpec {
  readonly body?: unknown;
  readonly ok?: boolean;
  readonly status?: number;
  readonly throws?: Error;
}

export interface RecordedCall {
  readonly action: string;
  readonly params: Record<string, unknown>;
}

export interface FakeFetchHandle {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: RecordedCall[];
}

export interface FakeFetchOptions {
  /** Set false when a test queues exact notesInfo/cardsInfo responses. */
  readonly useDefaultReconciliationResponses?: boolean;
}

export function makeFakeFetch(
  responses: readonly FakeResponseSpec[],
  options: FakeFetchOptions = {},
): FakeFetchHandle {
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

    // Existing-card reconciliation is a read-only preflight. Most orchestration
    // tests are concerned with the mutation queued below, so provide a stable
    // live-note default without consuming their response queue. Focused stale,
    // model, and deck tests use a purpose-built gateway instead.
    if (
      options.useDefaultReconciliationResponses !== false &&
      parsed.action === "notesInfo"
    ) {
      const notes = Array.isArray((parsed.params as { notes?: unknown })?.notes)
        ? ((parsed.params as { notes: unknown[] }).notes)
        : [];
      return {
        json: async () => ({
          error: null,
          result: notes
            .filter((nid): nid is number => typeof nid === "number")
            .map((noteId) => ({ noteId, tags: ["obsidian"] })),
        }),
        ok: true,
        status: 200,
      } as unknown as Response;
    }
    if (
      options.useDefaultReconciliationResponses !== false &&
      parsed.action === "cardsInfo"
    ) {
      return {
        json: async () => ({ error: null, result: [] }),
        ok: true,
        status: 200,
      } as unknown as Response;
    }

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

export function ok<T>(result: T): FakeResponseSpec {
  return { body: { error: null, result } };
}

export function err(error: string): FakeResponseSpec {
  return { body: { error, result: null } };
}

/**
 * Stubs the model-bootstrap chatter: modelNames followed by 4 v2-shaped
 * modelFieldNames responses (Context and Source fields present, no
 * extend-in-place upgrade fires). Caller passes the model name list expected
 * by the bootstrap.
 */
export function bootAllV2(
  modelNames: readonly string[],
): FakeResponseSpec[] {
  return [
    ok(modelNames),
    ok(["Front", "Back", "Context", "Source"]),
    ok(["Front", "Back", "Context", "Source"]),
    ok(["Text", "Extra", "Context", "Source"]),
    ok(["Content", "Context", "Source"]),
  ];
}
