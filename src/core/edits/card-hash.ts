import { createHash } from "node:crypto";

import type { Flashcard } from "../domain/card.js";

// Crockford-style base32 used across the project (drops `l, o, 0, 1`).
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * Stable content hash for a flashcard.
 *
 * Algorithm (locked):
 *  - input bytes: `kind + "\n" + front + "\n" + back` (UTF-8).
 *  - sha256, take leading 40 bits (5 bytes), encode MSB-first as 8 chars
 *    from the Crockford-style alphabet.
 *
 * Tags, deckName, and source positions are intentionally excluded.
 */
export function computeCardHash(card: Flashcard): string {
  const input = `${card.kind}\n${card.front}\n${card.answer}`;
  const digest = createHash("sha256").update(input, "utf8").digest();

  // Extract leading 40 bits as 8 × 5-bit groups, MSB-first.
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
