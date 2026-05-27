import { describe, expect, it } from "vitest";
import { renderFeatureFixture } from "./render-feature-fixture.js";

describe("renderFeatureFixture", () => {
  it("renders a basic inline card", () => {
    const result = renderFeatureFixture("Question::Answer\n", {
      notePath: "fixture.md",
    });
    expect(result).toHaveLength(1);
    const card = result[0]!;
    expect(card.modelName).toBe("Obsidian-basic");
    expect(card.deckName).toBe("Default");
    expect(card.tags).toEqual(["obsidian"]);
    expect(card.fields.Front).toContain("Question");
    expect(card.fields.Back).toContain("Answer");
    expect(card.fields.Source).toContain("card-0");
  });

  it("strips written-back block id anchors before parsing", () => {
    const clean = renderFeatureFixture("Question::Answer\n", {
      notePath: "fixture.md",
    });
    const dirty = renderFeatureFixture("Question::Answer ^abc1234567890\n", {
      notePath: "fixture.md",
    });
    expect(dirty).toEqual(clean);
  });

  it("assigns synthetic ids per card in document order", () => {
    const result = renderFeatureFixture("Q1::A1\n\nQ2::A2\n", {
      notePath: "fixture.md",
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.fields.Source).toContain("card-0");
    expect(result[1]!.fields.Source).toContain("card-1");
  });
});
