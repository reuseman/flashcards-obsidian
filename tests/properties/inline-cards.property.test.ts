import fc from "fast-check";

import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../src/core/parse/extract-cards.js";

describe("inline card properties", () => {
  test("inline syntax yields exactly one basic card with non-empty sides for safe paragraph text", () => {
    fc.assert(
      fc.property(
        safeInlineSideArbitrary(),
        safeInlineSideArbitrary(),
        (front, back) => {
          const result = extractCardsFromMarkdown(`${front}:: ${back}`, {
            notePath: "Property.md",
            settings: DEFAULT_SETTINGS,
          });

          expect(result.cards).toHaveLength(1);
          expect(result.cards[0]).toMatchObject({
            kind: "basic",
            source: {
              syntax: "inline",
            },
          });
          expect(result.cards[0]?.front.trim().length).toBeGreaterThan(0);
          expect(result.cards[0]?.answer.trim().length).toBeGreaterThan(0);
        },
      ),
    );
  });
});

function safeInlineSideArbitrary() {
  return fc
    .string({ minLength: 1 })
    .filter((value) => !value.includes("::"))
    .filter((value) => !value.includes("\n"))
    .filter((value) => value.trim().length > 0)
    .filter((value) => !value.includes("<!--"))
    .filter((value) => !value.includes("-->"))
    .filter((value) => !value.includes("```"))
    .filter((value) => !value.includes(":"))
    .filter((value) => !value.includes("{"))
    .filter((value) => !value.includes("}"))
    .filter((value) => !value.includes("=="))
    .filter((value) => !/^\s*[>#*-]/.test(value));
}
