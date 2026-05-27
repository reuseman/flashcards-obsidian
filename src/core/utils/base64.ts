/**
 * Binary-safe `Uint8Array` → base64. Works in browser / Obsidian renderer
 * (no Node `Buffer`). Uses `btoa` over a Latin-1 string built from the byte
 * values — each byte 0..255 maps to one code point, which `btoa` accepts.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  // Avoid `String.fromCharCode(...bytes)` on large inputs (call stack).
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}
