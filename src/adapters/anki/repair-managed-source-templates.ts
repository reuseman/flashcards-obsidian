import {
  ANKI_CONTEXT_TEMPLATE,
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
  ANKI_MODEL_REVERSED,
} from "../../core/render/render-card.js";
import type {
  AnkiModelTemplates,
  AnkiConnectClient,
} from "./anki-connect-client.js";

const MANAGED_MODELS = [
  ANKI_MODEL_BASIC,
  ANKI_MODEL_REVERSED,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
];
const SOURCE_TOKEN = "{{Source}}";

export interface SourceTemplateRepairResult {
  modelsUpdated: number;
  templatesUpdated: number;
}

/**
 * Repairs additive wrappers for managed Context and Source fields. Existing
 * template HTML is kept byte-for-byte inside the wrapper. Models without the
 * fields are left to the normal in-place field upgrade.
 */
export async function repairManagedSourceTemplates(
  client: AnkiConnectClient,
): Promise<SourceTemplateRepairResult> {
  const existing = new Set(await client.modelNames());
  let modelsUpdated = 0;
  let templatesUpdated = 0;

  for (const modelName of MANAGED_MODELS) {
    if (!existing.has(modelName)) continue;
    const fields = await client.modelFieldNames(modelName);
    const hasContext = fields.includes("Context");
    const hasSource = fields.includes("Source");
    if (!hasContext && !hasSource) continue;

    const current = await client.modelTemplates(modelName);
    const repaired = appendMissingManagedTokens(current, {
      context: hasContext,
      source: hasSource,
    });
    if (repaired.updated === 0) continue;

    await client.updateModelTemplates(modelName, repaired.templates);
    modelsUpdated++;
    templatesUpdated += repaired.updated;
  }

  return { modelsUpdated, templatesUpdated };
}

function appendMissingManagedTokens(
  templates: AnkiModelTemplates,
  fields: { context: boolean; source: boolean },
): {
  templates: AnkiModelTemplates;
  updated: number;
} {
  let updated = 0;
  const next: AnkiModelTemplates = {};

  for (const [name, template] of Object.entries(templates)) {
    let front = template.Front;
    let back = template.Back;
    if (fields.context && !front.includes("{{Context}}")) {
      front = `${ANKI_CONTEXT_TEMPLATE}${front}`;
    }
    if (
      fields.context &&
      !back.includes("{{Context}}") &&
      !back.includes("{{FrontSide}}")
    ) {
      back = `${ANKI_CONTEXT_TEMPLATE}${back}`;
    }
    if (fields.source && !back.includes(SOURCE_TOKEN)) {
      back = `${back}\n<br><br>${SOURCE_TOKEN}`;
    }
    if (front !== template.Front || back !== template.Back) updated++;
    next[name] = { Back: back, Front: front };
  }

  return { templates: next, updated };
}
