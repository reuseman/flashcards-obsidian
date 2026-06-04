import fs from "node:fs";
import path from "node:path";

import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../src/core/parse/extract-cards.js";

interface Expected {
  answer: string;
  front: string;
  kind: "basic" | "reversed";
}

const EXPECTED: Record<string, Expected> = {
  "basic-separate-line.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-inline-tag.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h1-separate-line.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h1-inline-tag.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h2-separate-line.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h2-inline-tag.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h3-separate-line.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h3-inline-tag.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h4-separate-line.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h4-inline-tag.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h5-separate-line.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h5-inline-tag.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h6-separate-line.md": { front: "Question", answer: "Answer", kind: "basic" },
  "basic-heading-h6-inline-tag.md": { front: "Question", answer: "Answer", kind: "basic" },
  "reverse-inline-tag.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-separate-line.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-slash-inline-tag.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-slash-separate-line.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h1-separate-line.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h1-inline-tag.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h2-separate-line.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h2-inline-tag.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h3-separate-line.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h3-inline-tag.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h4-separate-line.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h4-inline-tag.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h5-separate-line.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h5-inline-tag.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h6-separate-line.md": { front: "Question", answer: "Answer", kind: "reversed" },
  "reverse-heading-h6-inline-tag.md": { front: "Question", answer: "Answer", kind: "reversed" },
};

describe("hashtag compatibility fixtures", () => {
  const fixturesDir = path.join(
    __dirname,
    "..",
    "fixtures",
    "compatibility",
    "v1",
    "hashtag",
  );

  test.each(loadFixtures(fixturesDir))(
    "parses hashtag fixture %s as a single card",
    (fixtureName, markdown) => {
      const expected = EXPECTED[fixtureName];
      if (!expected) {
        throw new Error(`No expected values defined for fixture ${fixtureName}`);
      }

      const result = extractCardsFromMarkdown(markdown, {
        notePath: fixtureName,
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: expected.answer,
        front: expected.front,
        kind: expected.kind,
        source: { syntax: "hashtag" },
      });
    },
  );
});

function loadFixtures(dir: string): Array<[string, string]> {
  return fs
    .readdirSync(dir)
    .filter((filename) => filename.endsWith(".md"))
    .sort()
    .map((filename) => [filename, fs.readFileSync(path.join(dir, filename), "utf8")] as [string, string]);
}
