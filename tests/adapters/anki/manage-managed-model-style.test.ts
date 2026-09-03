import { describe, expect, it } from "vitest";

import { AnkiConnectClient } from "../../../src/adapters/anki/anki-connect-client.js";
import {
  applyManagedModelStyle,
  inspectManagedModelStyle,
} from "../../../src/adapters/anki/manage-managed-model-style.js";
import {
  ANKI_MODEL_BASIC,
  getAnkiModelSpecs,
} from "../../../src/core/render/render-card.js";
import { makeFakeFetch, ok } from "../../_utils/fake-fetch.js";

const CUSTOM_TEMPLATES = {
  "My forward card": {
    Back: "{{FrontSide}}<hr>{{Back}}<script>custom()</script>{{Source}}",
    Front: "{{Front}}<div>{{Tags}}</div>",
  },
};

describe("inspectManagedModelStyle", () => {
  it("keeps an exact backup and maps the v2 template onto the existing template name", async () => {
    const { fetch } = makeFakeFetch([
      ok([ANKI_MODEL_BASIC]),
      ok(["Front", "Back", "Source"]),
      ok(CUSTOM_TEMPLATES),
      ok({ css: ".card { color: hotpink; }" }),
    ]);

    const plan = await inspectManagedModelStyle(
      new AnkiConnectClient({ fetch }),
    );

    expect(plan.blocked).toEqual([]);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]?.current).toEqual({
      css: ".card { color: hotpink; }",
      fields: ["Front", "Back", "Source"],
      templates: CUSTOM_TEMPLATES,
    });
    expect(plan.changes[0]?.desired.templates).toEqual({
      "My forward card": expect.objectContaining({
        Back: expect.stringContaining("flashcards-source-footer"),
        Front: expect.stringContaining("flashcards-question"),
      }),
    });
  });

  it("blocks a model whose content fields cannot support the managed template", async () => {
    const { fetch } = makeFakeFetch([
      ok([ANKI_MODEL_BASIC]),
      ok(["Prompt", "Response"]),
      ok(CUSTOM_TEMPLATES),
      ok({ css: ".card {}" }),
    ]);

    const plan = await inspectManagedModelStyle(
      new AnkiConnectClient({ fetch }),
    );

    expect(plan.changes).toEqual([]);
    expect(plan.blocked).toEqual([
      {
        modelName: ANKI_MODEL_BASIC,
        reason: "Missing required fields: Front, Back",
      },
    ]);
  });

  it("blocks a model with an incompatible number of card templates", async () => {
    const { fetch } = makeFakeFetch([
      ok([ANKI_MODEL_BASIC]),
      ok(["Front", "Back", "Source"]),
      ok({
        "Card 1": { Back: "{{Back}}", Front: "{{Front}}" },
        "Card 2": { Back: "{{Front}}", Front: "{{Back}}" },
      }),
      ok({ css: ".card {}" }),
    ]);

    const plan = await inspectManagedModelStyle(
      new AnkiConnectClient({ fetch }),
    );

    expect(plan.changes).toEqual([]);
    expect(plan.blocked).toEqual([
      {
        modelName: ANKI_MODEL_BASIC,
        reason: "Expected 1 card template, found 2",
      },
    ]);
  });

  it("does not plan a write when the model already matches v2", async () => {
    const spec = getAnkiModelSpecs().find(
      (candidate) => candidate.modelName === ANKI_MODEL_BASIC,
    )!;
    const templates = {
      "Card 1": {
        Back: spec.cardTemplates[0]!.Back,
        Front: spec.cardTemplates[0]!.Front,
      },
    };
    const { fetch } = makeFakeFetch([
      ok([ANKI_MODEL_BASIC]),
      ok(spec.inOrderFields),
      ok(templates),
      ok({ css: spec.css }),
    ]);

    const plan = await inspectManagedModelStyle(
      new AnkiConnectClient({ fetch }),
    );

    expect(plan).toEqual({ blocked: [], changes: [] });
  });
});

describe("applyManagedModelStyle", () => {
  it("adds a missing Source field before applying templates and CSS", async () => {
    const spec = getAnkiModelSpecs().find(
      (candidate) => candidate.modelName === ANKI_MODEL_BASIC,
    )!;
    const desiredTemplates = {
      "Card 1": {
        Back: spec.cardTemplates[0]!.Back,
        Front: spec.cardTemplates[0]!.Front,
      },
    };
    const plan = {
      blocked: [],
      changes: [
        {
          current: {
            css: ".card {}",
            fields: ["Front", "Back"],
            templates: CUSTOM_TEMPLATES,
          },
          desired: { css: spec.css!, templates: desiredTemplates },
          missingSource: true,
          modelName: ANKI_MODEL_BASIC,
        },
      ],
    };
    const { calls, fetch } = makeFakeFetch([ok(null), ok(null), ok(null)]);

    await applyManagedModelStyle(new AnkiConnectClient({ fetch }), plan);

    expect(calls.map((call) => call.action)).toEqual([
      "modelFieldAdd",
      "updateModelTemplates",
      "updateModelStyling",
    ]);
  });
});
