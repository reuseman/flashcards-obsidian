import type {
  AnkiConnectClient,
  AnkiRequest,
} from "./anki-connect-client.js";
import { bytesToBase64 } from "../../core/utils/base64.js";
import type { ResolvedMedia } from "../obsidian/media-resolver.js";

/**
 * Batches `storeMediaFile` into a single AnkiConnect `multi` call.
 * Dedups by `finalName` (content-hash = same bytes by definition).
 * Empty input → no network call.
 */
export async function uploadMedia(
  client: AnkiConnectClient,
  media: Iterable<ResolvedMedia>,
): Promise<void> {
  const seen = new Set<string>();
  const actions: AnkiRequest[] = [];
  for (const m of media) {
    if (seen.has(m.finalName)) continue;
    seen.add(m.finalName);
    actions.push({
      action: "storeMediaFile",
      params: { filename: m.finalName, data: bytesToBase64(m.bytes) },
    });
  }
  if (actions.length === 0) return;
  await client.multi(actions);
}
