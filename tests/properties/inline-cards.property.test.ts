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

// Generates content for one side ("front" or "back") of an inline `front::
// back` card. The generated string must be plain paragraph text that the
// markdown parser (mdast/micromark) will *not* interpret as a delimited
// construct able to escape or swallow the `::` delimiter placed between the
// two sides, or the sibling side's content:
//   - `\` is CommonMark's escape character: a trailing/leading backslash can
//     escape the character next to it once the two sides are concatenated
//     around `::`.
//   - a single backtick is one half of an inline-code-span delimiter pair;
//     when front and back each contribute a lone backtick, the pair can
//     close *across* the `::`, turning it (and the delimiter) into code
//     content that is never scanned for cards. A backtick pair *within* one
//     side also empties that side down to whitespace-only code content.
//   - a leading `<` opens raw HTML (comment, declaration, processing
//     instruction, CDATA, or tag) per CommonMark, which can likewise swallow
//     the delimiter or the sibling side.
// Excluding all three characters keeps the generator inside the "plain
// paragraph text" precondition the property actually needs, while still
// exercising unicode, punctuation, and `:`-adjacent (but not `::`) content.
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
    .filter((value) => !value.includes("\\"))
    .filter((value) => !value.includes("`"))
    .filter((value) => !value.includes("<"))
    .filter((value) => !/^\s*[>#*-]/.test(value));
}
