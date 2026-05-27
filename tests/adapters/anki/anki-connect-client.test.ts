import { describe, expect, it } from "vitest";
import { AnkiConnectClient } from "../../../src/adapters/anki/anki-connect-client.js";

/**
 * Phase 6 slice 6a — typed AnkiConnect client (transport layer only).
 *
 * Module under test (scaffold exists; typed methods NOT yet implemented):
 *   src/adapters/anki/anki-connect-client.ts
 *
 * Locked decisions:
 *   - Protocol version 6.
 *   - Default endpoint http://127.0.0.1:8765.
 *   - Optional apiKey constructor param → included as `key` field in envelope.
 *   - Injectable fetch (defaults to globalThis.fetch).
 *   - Envelope: { action, version, params, [key] }; Content-Type application/json; POST.
 *   - Response: error !== null → throw with .message === error string.
 *                error === null → return result (may be null, caller interprets).
 *   - Network rejection bubbles up unchanged.
 *   - Non-2xx HTTP response → throw with message exactly "AnkiConnect HTTP <status>".
 *     (Locked here. Implementation must match.)
 *   - No `multi` action.
 */

interface FakeResponseSpec {
  readonly body?: unknown;
  readonly ok?: boolean;
  readonly status?: number;
  readonly throws?: Error;
}

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

interface FakeFetchHandle {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: RecordedCall[];
}

function makeFakeFetch(responses: readonly FakeResponseSpec[]): FakeFetchHandle {
  const queue = [...responses];
  const calls: RecordedCall[] = [];

  const fakeFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const rawBody = init?.body;
    const parsedBody =
      typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    const headersInit = init?.headers ?? {};
    const headers: Record<string, string> = {};
    if (headersInit instanceof Headers) {
      headersInit.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(headersInit)) {
      for (const [k, v] of headersInit) headers[k] = v;
    } else {
      Object.assign(headers, headersInit as Record<string, string>);
    }

    calls.push({
      body: parsedBody,
      headers,
      method: init?.method ?? "GET",
      url,
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

function okBody<T>(result: T): FakeResponseSpec {
  return { body: { error: null, result } };
}

function errBody(error: string): FakeResponseSpec {
  return { body: { error, result: null } };
}

describe("AnkiConnectClient — request envelope", () => {
  it("posts JSON with action, version 6, params, no key when apiKey is unset", async () => {
    const { calls, fetch } = makeFakeFetch([okBody(6)]);
    const client = new AnkiConnectClient({ fetch });

    await client.version();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:8765");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["Content-Type"]).toBe("application/json");
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.action).toBe("version");
    expect(body.version).toBe(6);
    expect(body.params).toEqual({});
    expect("key" in body).toBe(false);
  });

  it("includes `key` in every request when apiKey is configured", async () => {
    const { calls, fetch } = makeFakeFetch([okBody(6), okBody([])]);
    const client = new AnkiConnectClient({ apiKey: "s3cret", fetch });

    await client.version();
    await client.deckNames();

    expect(calls).toHaveLength(2);
    expect((calls[0]!.body as Record<string, unknown>).key).toBe("s3cret");
    expect((calls[1]!.body as Record<string, unknown>).key).toBe("s3cret");
  });

  it("posts to the configured endpoint when overridden", async () => {
    const { calls, fetch } = makeFakeFetch([okBody(6)]);
    const client = new AnkiConnectClient({
      endpoint: "http://anki.local:9000",
      fetch,
    });

    await client.version();

    expect(calls[0]!.url).toBe("http://anki.local:9000");
  });
});

describe("AnkiConnectClient — response unwrapping", () => {
  it("returns the `result` field when error is null", async () => {
    const { fetch } = makeFakeFetch([okBody(42)]);
    const client = new AnkiConnectClient({ fetch });

    await expect(client.version()).resolves.toBe(42);
  });

  it("throws with message === error string when error !== null", async () => {
    const { fetch } = makeFakeFetch([errBody("model was not found: foo")]);
    const client = new AnkiConnectClient({ fetch });

    await expect(client.modelNames()).rejects.toThrow(
      "model was not found: foo",
    );
  });
});

describe("AnkiConnectClient — version()", () => {
  it("sends action `version` with empty params and returns the integer", async () => {
    const { calls, fetch } = makeFakeFetch([okBody(6)]);
    const client = new AnkiConnectClient({ fetch });

    const result = await client.version();

    expect(result).toBe(6);
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.action).toBe("version");
    expect(body.params).toEqual({});
  });
});

describe("AnkiConnectClient — deckNames()", () => {
  it("sends action `deckNames` and returns string array", async () => {
    const { calls, fetch } = makeFakeFetch([okBody(["Default", "X"])]);
    const client = new AnkiConnectClient({ fetch });

    const result = await client.deckNames();

    expect(result).toEqual(["Default", "X"]);
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.action).toBe("deckNames");
    expect(body.params).toEqual({});
  });
});

describe("AnkiConnectClient — createDeck()", () => {
  it("sends action `createDeck` with `deck` param and returns deck id", async () => {
    const { calls, fetch } = makeFakeFetch([okBody(1714)]);
    const client = new AnkiConnectClient({ fetch });

    const id = await client.createDeck("Foo::Bar");

    expect(id).toBe(1714);
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.action).toBe("createDeck");
    expect(body.params).toEqual({ deck: "Foo::Bar" });
  });
});

describe("AnkiConnectClient — modelNames()", () => {
  it("sends action `modelNames` and returns string array", async () => {
    const { calls, fetch } = makeFakeFetch([
      okBody(["Basic", "Cloze", "Obsidian-Basic"]),
    ]);
    const client = new AnkiConnectClient({ fetch });

    const result = await client.modelNames();

    expect(result).toEqual(["Basic", "Cloze", "Obsidian-Basic"]);
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.action).toBe("modelNames");
    expect(body.params).toEqual({});
  });
});

describe("AnkiConnectClient — createModel()", () => {
  it("forwards the spec verbatim as params and returns whatever Anki returns", async () => {
    const { calls, fetch } = makeFakeFetch([okBody({ id: 9999 })]);
    const client = new AnkiConnectClient({ fetch });

    const spec = {
      cardTemplates: [
        {
          Back: "{{Front}}<hr>{{Back}}",
          Front: "{{Front}}",
          Name: "Card 1",
        },
      ],
      css: ".card { font-family: sans-serif; }",
      inOrderFields: ["Front", "Back", "Source"],
      isCloze: false,
      modelName: "Obsidian-Basic",
    };

    const result = await client.createModel(spec);

    expect(result).toEqual({ id: 9999 });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.action).toBe("createModel");
    expect(body.params).toEqual(spec);
  });
});

describe("AnkiConnectClient — addNote()", () => {
  it("sends action `addNote` wrapping the note in `{ note: ... }` and returns nid", async () => {
    const { calls, fetch } = makeFakeFetch([okBody(1714123456789)]);
    const client = new AnkiConnectClient({ fetch });

    const note = {
      deckName: "Foo",
      fields: { Back: "B", Front: "A" },
      modelName: "Obsidian-Basic",
      tags: ["t1", "t2"],
    };

    const nid = await client.addNote(note);

    expect(nid).toBe(1714123456789);
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.action).toBe("addNote");
    expect(body.params).toEqual({ note });
  });

  it("returns null when AnkiConnect returns `result: null, error: null` (silent duplicate)", async () => {
    const { fetch } = makeFakeFetch([{ body: { error: null, result: null } }]);
    const client = new AnkiConnectClient({ fetch });

    const nid = await client.addNote({
      deckName: "Foo",
      fields: { Back: "B", Front: "A" },
      modelName: "Obsidian-Basic",
      tags: [],
    });

    expect(nid).toBeNull();
  });

  it("throws (does not return null) when error field is set", async () => {
    const { fetch } = makeFakeFetch([errBody("model was not found: foo")]);
    const client = new AnkiConnectClient({ fetch });

    await expect(
      client.addNote({
        deckName: "Foo",
        fields: { Back: "B", Front: "A" },
        modelName: "foo",
        tags: [],
      }),
    ).rejects.toThrow("model was not found: foo");
  });
});

describe("AnkiConnectClient — updateNoteFields()", () => {
  it("sends action `updateNoteFields` with `{ note: { id, fields } }` and resolves undefined", async () => {
    const { calls, fetch } = makeFakeFetch([okBody(null)]);
    const client = new AnkiConnectClient({ fetch });

    const result = await client.updateNoteFields(1714, {
      Back: "Y",
      Front: "X",
    });

    expect(result).toBeUndefined();
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.action).toBe("updateNoteFields");
    expect(body.params).toEqual({
      note: { fields: { Back: "Y", Front: "X" }, id: 1714 },
    });
  });
});

describe("AnkiConnectClient — deleteNotes()", () => {
  it("sends action `deleteNotes` with `{ notes: [...] }` and resolves undefined", async () => {
    const { calls, fetch } = makeFakeFetch([okBody(null)]);
    const client = new AnkiConnectClient({ fetch });

    const result = await client.deleteNotes([1714, 1715]);

    expect(result).toBeUndefined();
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.action).toBe("deleteNotes");
    expect(body.params).toEqual({ notes: [1714, 1715] });
  });
});

describe("AnkiConnectClient — error scenarios", () => {
  it("bubbles up transport-level rejections unchanged", async () => {
    const networkError = new Error("ECONNREFUSED");
    const { fetch } = makeFakeFetch([{ throws: networkError }]);
    const client = new AnkiConnectClient({ fetch });

    await expect(client.version()).rejects.toBe(networkError);
  });

  it("throws `AnkiConnect HTTP <status>` on non-2xx response", async () => {
    // Locked message: "AnkiConnect HTTP 500" (no trailing punctuation, no statusText).
    const { fetch } = makeFakeFetch([{ ok: false, status: 500 }]);
    const client = new AnkiConnectClient({ fetch });

    await expect(client.version()).rejects.toThrow("AnkiConnect HTTP 500");
  });
});
