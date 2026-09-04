import type {
  AnkiGateway,
  SyncExecutionSession,
} from "../ports.js";
import type { Logger } from "../../core/logging/logger.js";
import {
  ANKI_CONTEXT_TEMPLATE,
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
  ANKI_MODEL_REVERSED,
  getAnkiModelSpecs,
} from "../../core/render/render-card.js";

const REQUIRED_MODELS = [
  ANKI_MODEL_BASIC,
  ANKI_MODEL_REVERSED,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
];
const CONTEXT_TOKEN = "{{Context}}";

function extendManagedTemplates(
  templates: Record<string, { Back: string; Front: string }>,
): Record<string, { Back: string; Front: string }> {
  return Object.fromEntries(
    Object.entries(templates).map(([templateName, template]) => {
      const front = template.Front.includes(CONTEXT_TOKEN)
        ? template.Front
        : `${ANKI_CONTEXT_TEMPLATE}${template.Front}`;
      let back = template.Back.includes("{{Source}}")
        ? template.Back
        : `${template.Back}\n<br><br>{{Source}}`;
      if (!back.includes(CONTEXT_TOKEN) && !back.includes("{{FrontSide}}")) {
        back = `${ANKI_CONTEXT_TEMPLATE}${back}`;
      }
      return [templateName, { Back: back, Front: front }];
    }),
  );
}

export async function sessionModelNames(
  client: AnkiGateway,
  session: SyncExecutionSession,
): Promise<Set<string>> {
  session.modelNames ??= client.modelNames().then((names) => new Set(names));
  try {
    return await session.modelNames;
  } catch (error) {
    delete session.modelNames;
    throw error;
  }
}

export async function sessionModelFields(
  client: AnkiGateway,
  session: SyncExecutionSession,
  modelName: string,
): Promise<string[]> {
  session.modelFields ??= new Map();
  let fields = session.modelFields.get(modelName);
  if (fields === undefined) {
    fields = client.modelFieldNames(modelName);
    session.modelFields.set(modelName, fields);
  }
  try {
    return await fields;
  } catch (error) {
    session.modelFields.delete(modelName);
    throw error;
  }
}

async function bootstrapManagedModels(
  client: AnkiGateway,
  logger: Logger,
  session: SyncExecutionSession,
): Promise<void> {
  const existingModels = await sessionModelNames(client, session);
  const specs = getAnkiModelSpecs();
  for (const name of REQUIRED_MODELS) {
    const spec = specs.find((candidate) => candidate.modelName === name);
    if (spec === undefined) continue;
    if (!existingModels.has(name)) {
      logger.info("bootstrap: creating missing model", { model: name });
      await client.createModel(spec);
      existingModels.add(name);
      continue;
    }

    const fields = await sessionModelFields(client, session, name);
    const missingContext = !fields.includes("Context");
    const missingSource = !fields.includes("Source");
    if (!missingContext && !missingSource) {
      if (session.modelsNeedingTemplateRepair?.has(name) === true) {
        const templates = await client.modelTemplates(name);
        await client.updateModelTemplates(name, extendManagedTemplates(templates));
        session.modelsNeedingTemplateRepair.delete(name);
      }
      logger.debug("bootstrap: model already v2-shaped", { model: name });
      continue;
    }

    logger.info("bootstrap: extending managed model fields", {
      model: name,
      existingFields: fields,
      missingContext,
      missingSource,
    });
    const templates = await client.modelTemplates(name);
    const nextFields = [...fields];
    if (missingContext) {
      const sourceIndex = nextFields.indexOf("Source");
      const contextIndex = sourceIndex === -1 ? nextFields.length : sourceIndex;
      await client.modelFieldAdd(name, "Context", contextIndex);
      nextFields.splice(contextIndex, 0, "Context");
    }
    if (missingSource) {
      await client.modelFieldAdd(name, "Source", nextFields.length);
      nextFields.push("Source");
    }
    session.modelFields?.set(name, Promise.resolve(nextFields));
    session.modelsNeedingTemplateRepair ??= new Set();
    session.modelsNeedingTemplateRepair.add(name);
    await client.updateModelTemplates(name, extendManagedTemplates(templates));
    session.modelsNeedingTemplateRepair.delete(name);
  }
}

export async function ensureManagedModels(
  client: AnkiGateway,
  logger: Logger,
  session: SyncExecutionSession,
): Promise<void> {
  session.modelsReady ??= bootstrapManagedModels(client, logger, session);
  try {
    await session.modelsReady;
  } catch (error) {
    delete session.modelsReady;
    throw error;
  }
}
