import { requestUrl } from "obsidian";

import type { AnkiConnectTransport } from "../anki/anki-connect-client.js";

/**
 * Uses Obsidian's native request API instead of browser fetch. AnkiConnect's
 * default CORS allow-list does not include the `app://obsidian.md` origin, and
 * users should not have to weaken that allow-list for a local desktop plugin.
 */
export const obsidianAnkiConnectTransport: AnkiConnectTransport = async (
  endpoint,
  envelope,
) => {
  try {
    const response = await requestUrl({
      body: JSON.stringify(envelope),
      contentType: "application/json",
      method: "POST",
      throw: false,
      url: endpoint,
    });
    return {
      json: async () => response.json as unknown,
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
    };
  } catch {
    throw new Error(
      `Cannot reach AnkiConnect at ${endpoint}. Start Anki, confirm the AnkiConnect add-on is installed, and try again.`,
    );
  }
};
