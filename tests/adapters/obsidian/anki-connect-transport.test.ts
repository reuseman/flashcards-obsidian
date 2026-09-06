import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => ({ requestUrl }));

import { obsidianAnkiConnectTransport } from "../../../src/adapters/obsidian/anki-connect-transport.js";

describe("Obsidian AnkiConnect transport", () => {
  beforeEach(() => {
    requestUrl.mockReset();
  });

  it("posts through requestUrl without relying on browser CORS", async () => {
    requestUrl.mockResolvedValue({
      json: { error: null, result: 6 },
      status: 200,
    });

    const response = await obsidianAnkiConnectTransport(
      "http://127.0.0.1:8765",
      { action: "version", params: {}, version: 6 },
    );

    expect(requestUrl).toHaveBeenCalledWith({
      body: JSON.stringify({ action: "version", params: {}, version: 6 }),
      contentType: "application/json",
      method: "POST",
      throw: false,
      url: "http://127.0.0.1:8765",
    });
    expect(response).toMatchObject({ ok: true, status: 200 });
    await expect(response.json()).resolves.toEqual({ error: null, result: 6 });
  });

  it("turns connection failures into setup guidance", async () => {
    requestUrl.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));

    await expect(
      obsidianAnkiConnectTransport("http://127.0.0.1:8765", {
        action: "version",
        params: {},
        version: 6,
      }),
    ).rejects.toThrow(
      "Cannot reach AnkiConnect at http://127.0.0.1:8765. Start Anki, confirm the AnkiConnect add-on is installed, and try again.",
    );
  });
});
