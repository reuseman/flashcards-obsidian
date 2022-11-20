import dedent from "ts-dedent";
import { Regex } from "../src/conf/regex";

describe("Regex class unit tests", () => {
  describe("inline card pattern", () => {
    it("should work with default settings", () => {
      const regex = new Regex({
        contextAwareMode: true,
        sourceSupport: false,
        codeHighlightSupport: false,
        inlineID: false,
        contextSeparator: " > ",
        deck: "Default",
        folderBasedDeck: true,
        flashcardsTag: "card",
        inlineSeparator: "::",
        inlineSeparatorReverse: ":::",
        defaultAnkiTag: "obsidian",
        ankiConnectPermission: false,
      });

      type Match = [string, string];

      const candidates: [string, Match[]][] = [
        ["#Question :: Answer", [["Question", "Answer"]]],
        ["Answer ::: Question", [["Answer", "Question"]]],
        ["Question :: Answer ^123456789", [["Question", "Answer ^123456789"]]],
        ["Question :: Answer ^123456789\n^123456789", [["Question", "Answer ^123456789"]]],
        // FIXME: should be "The question" instead of " The question"
        ["## Question #card\n- The question :: Answer", [[" The question", "Answer"]]],
        ["No match!", []],
        // FIXME: should be "Question 1" instead of " Question 1"
        [
          dedent`
          1. Question 1 :: Answer 1
          2. Question 2 :: Answer 2
          3. Question 3 :: Answer 3`,
          [
            [" Question 1", "Answer 1"],
            [" Question 2", "Answer 2"],
            [" Question 3", "Answer 3"],
          ],
        ],
        // FIXME: should be "Question 1" instead of " Question 1"
        [
          dedent`
          - Question 1 :: Answer 1
          - Question 2 :: Answer 2
          - Question 3 :: Answer 3`,
          [
            [" Question 1", "Answer 1"],
            [" Question 2", "Answer 2"],
            [" Question 3", "Answer 3"],
          ],
        ],
        [
          dedent`
          1. Item 1 :: A
          2. Item 2 :: B
            - Item 2a :: Ba
            - Item 2b :: Bb`,
          [
            [" Item 1", "A"],
            [" Item 2", "B"],
            [" Item 2a", "Ba"],
            [" Item 2b", "Bb"],
          ],
        ],
        // FIXME: should not match
        // ["no :::: match", []],
        ["2000 :: answer", [["2000", "answer"]]],
      ];

      for (const [input, expected] of candidates) {
        const matches = [...input.matchAll(regex.cardsInlineStyle)];

        expect(matches.length).toEqual(expected.length);
        expected.forEach((exp, i) => {
          const match = matches[i];
          expect(match[2]).toEqual(exp[0]);
          expect(match[4]).toEqual(exp[1]);
        });
      }
    });
  });
});
