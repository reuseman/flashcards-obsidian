import { describe, expect, it } from "vitest";

import { AnkiConnectClient } from "../../../src/adapters/anki/anki-connect-client.js";
import { repairManagedSourceTemplates } from "../../../src/adapters/anki/repair-managed-source-templates.js";
import { ANKI_MODEL_BASIC } from "../../../src/core/render/render-card.js";
import { makeFakeFetch, ok } from "../../_utils/fake-fetch.js";

describe("repairManagedSourceTemplates", () => {
  it("appends Source to a customized Back template without replacing its HTML", async () => {
    const custom = {
      "Front / Back": {
        Back: "{{FrontSide}}\n<hr id=answer>\n{{Back}}\n<footer>Mine</footer>",
        Front: "{{Front}}\n<p class=tags>{{Tags}}</p>",
      },
    };
    const { calls, fetch } = makeFakeFetch([
      ok([ANKI_MODEL_BASIC]),
      ok(["Front", "Back", "Source"]),
      ok(custom),
      ok(null),
    ]);

    const result = await repairManagedSourceTemplates(
      new AnkiConnectClient({ fetch }),
    );

    expect(result).toEqual({ modelsUpdated: 1, templatesUpdated: 1 });
    const update = calls.find(
      (call) => call.action === "updateModelTemplates",
    );
    expect(update?.params).toEqual({
      model: {
        name: ANKI_MODEL_BASIC,
        templates: {
          "Front / Back": {
            Back:
              "{{FrontSide}}\n<hr id=answer>\n{{Back}}\n<footer>Mine</footer>\n<br><br>{{Source}}",
            Front: "{{Front}}\n<p class=tags>{{Tags}}</p>",
          },
        },
      },
    });
  });

  it("does not modify a template that already renders Source", async () => {
    const { calls, fetch } = makeFakeFetch([
      ok([ANKI_MODEL_BASIC]),
      ok(["Front", "Back", "Source"]),
      ok({
        Card: {
          Back: "{{FrontSide}}<hr>{{Back}}<br>{{Source}}",
          Front: "{{Front}}",
        },
      }),
    ]);

    const result = await repairManagedSourceTemplates(
      new AnkiConnectClient({ fetch }),
    );

    expect(result).toEqual({ modelsUpdated: 0, templatesUpdated: 0 });
    expect(
      calls.some((call) => call.action === "updateModelTemplates"),
    ).toBe(false);
  });
});
