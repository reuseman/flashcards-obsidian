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

export function makeFakeFetch(
  responses: readonly FakeResponseSpec[],
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
 * Stubs the model-bootstrap chatter: modelNames followed by 3 v2-shaped
 * modelFieldNames responses (Source field present, no extend-in-place
 * upgrade fires). Caller passes the model name list expected by the
 * bootstrap.
 */
export function bootAllV2(
  modelNames: readonly string[],
): FakeResponseSpec[] {
  return [
    ok(modelNames),
    ok(["Front", "Back", "Source"]),
    ok(["Front", "Back", "Source"]),
    ok(["Text", "Extra", "Source"]),
  ];
}
