import { describe, expect, it } from "vitest";

import { bytesToBase64 } from "../../../src/core/utils/base64.js";

describe("bytesToBase64", () => {
  it("encodes empty input as empty string", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });

  it("encodes the canonical RFC 4648 sample", () => {
    // "Many hands make light work."
    const bytes = new TextEncoder().encode("Many hands make light work.");
    expect(bytesToBase64(bytes)).toBe("TWFueSBoYW5kcyBtYWtlIGxpZ2h0IHdvcmsu");
  });

  it("pads with `=` for 1-byte and 2-byte remainders", () => {
    expect(bytesToBase64(new Uint8Array([0x66]))).toBe("Zg==");
    expect(bytesToBase64(new Uint8Array([0x66, 0x6f]))).toBe("Zm8=");
    expect(bytesToBase64(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe("Zm9v");
  });

  it("handles bytes outside ASCII (binary safe)", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // PNG magic; base64 verified via `printf ... | base64`.
    expect(bytesToBase64(bytes)).toBe("iVBORw0KGgo=");
  });
});
