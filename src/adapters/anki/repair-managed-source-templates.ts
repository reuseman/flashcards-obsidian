import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
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
];
const SOURCE_TOKEN = "{{Source}}";

export interface SourceTemplateRepairResult {
  modelsUpdated: number;
  templatesUpdated: number;
}

/**
 * Repairs models that have a Source field but do not render it. Existing
 * template HTML is kept byte-for-byte; only a missing token is appended to
 * the Back side. Models without the field are left to the normal v1 upgrade.
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
    if (!fields.includes("Source")) continue;

    const current = await client.modelTemplates(modelName);
    const repaired = appendMissingSourceTokens(current);
    if (repaired.updated === 0) continue;

    await client.updateModelTemplates(modelName, repaired.templates);
    modelsUpdated++;
    templatesUpdated += repaired.updated;
  }

  return { modelsUpdated, templatesUpdated };
}

function appendMissingSourceTokens(templates: AnkiModelTemplates): {
  templates: AnkiModelTemplates;
  updated: number;
} {
  let updated = 0;
  const next: AnkiModelTemplates = {};

  for (const [name, template] of Object.entries(templates)) {
    if (template.Back.includes(SOURCE_TOKEN)) {
      next[name] = template;
      continue;
    }
    updated++;
    next[name] = {
      Back: `${template.Back}\n<br><br>${SOURCE_TOKEN}`,
      Front: template.Front,
    };
  }

  return { templates: next, updated };
}
