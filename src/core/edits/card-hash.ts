import { createHash } from "node:crypto";

import type { CardKind, Flashcard } from "../domain/card.js";

// Crockford-style base32 used across the project (drops `l, o, 0, 1`).
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function toBase32(digest: Buffer): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    const bitOffset = i * 5;
    const byteIndex = bitOffset >> 3;
    const bitInByte = bitOffset & 7;

    // The 5-bit group may span two bytes. Read up to 13 bits from
    // (byteIndex, byteIndex+1) into a 16-bit window, then shift down.
    const hi = digest[byteIndex] ?? 0;
    const lo = digest[byteIndex + 1] ?? 0;
    const window = (hi << 8) | lo;
    const shift = 16 - bitInByte - 5;
    const value = (window >> shift) & 0x1f;

    out += ALPHABET[value];
  }
  return out;
}

/**
 * Stable content hash for a flashcard.
 *
 * Algorithm (locked):
 *  - input bytes: `kind + "\n" + context + "\n" + front + "\n" + back`
 *    (UTF-8); absent context is the empty string.
 *  - sha256, take leading 40 bits (5 bytes), encode MSB-first as 8 chars
 *    from the Crockford-style alphabet.
 *
 * Tags, deckName, and source positions are intentionally excluded.
 */
export function computeCardHash(card: Flashcard): string {
  const input = `${card.kind}\n${card.context ?? ""}\n${card.front}\n${card.answer}`;
  const digest = createHash("sha256").update(input, "utf8").digest();
  return toBase32(digest);
}

/**
 * Hash of the plugin-owned HTML fields last written to Anki. This is a
 * disposable reconciliation cache: losing it causes one corrective UPDATE,
 * never a new note.
 */
export function computeRenderedFieldsHash(
  fields: Record<string, string>,
): string {
  const input = Object.keys(fields)
    .sort()
    .map((key) => `${key}\n${fields[key] ?? ""}`)
    .join("\n");
  const digest = createHash("sha256").update(input, "utf8").digest();
  return toBase32(digest);
}

/**
 * Cue hash for anchorless (atomic) card identity (WI-9, design §4.4).
 *
 * Algorithm (locked): sha256 of `kind + "\n" + front`, same leading-40-bit
 * base32 encoding as `computeCardHash`. Kind is included so a `title` and a
 * `reversed` item sharing the same front text (the note title) get distinct
 * cues.
 */
export function computeCueHash(kind: CardKind, front: string): string {
  const input = `${kind}\n${front}`;
  const digest = createHash("sha256").update(input, "utf8").digest();
  return toBase32(digest);
}
