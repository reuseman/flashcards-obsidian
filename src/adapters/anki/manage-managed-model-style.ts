import { getAnkiModelSpecs } from "../../core/render/render-card.js";
import type {
  AnkiConnectClient,
  AnkiModelTemplates,
} from "./anki-connect-client.js";

export interface ManagedModelStyleSnapshot {
  css: string;
  fields: string[];
  templates: AnkiModelTemplates;
}

export interface ManagedModelStyleTarget {
  css: string;
  templates: AnkiModelTemplates;
}

export interface ManagedModelStyleChange {
  current: ManagedModelStyleSnapshot;
  desired: ManagedModelStyleTarget;
  missingSource: boolean;
  modelName: string;
}

export interface ManagedModelStyleBlock {
  modelName: string;
  reason: string;
}

export interface ManagedModelStylePlan {
  blocked: ManagedModelStyleBlock[];
  changes: ManagedModelStyleChange[];
}

/**
 * Builds a read-only migration plan for the managed Anki models that already
 * exist. Template content is mapped by card order so custom template names do
 * not have to change.
 */
export async function inspectManagedModelStyle(
  client: AnkiConnectClient,
): Promise<ManagedModelStylePlan> {
  const existingModels = new Set(await client.modelNames());
  const plan: ManagedModelStylePlan = { blocked: [], changes: [] };

  for (const spec of getAnkiModelSpecs()) {
    if (!existingModels.has(spec.modelName)) continue;

    const fields = await client.modelFieldNames(spec.modelName);
    const templates = await client.modelTemplates(spec.modelName);
    const { css } = await client.modelStyling(spec.modelName);
    const requiredContentFields = spec.inOrderFields.filter(
      (field) => field !== "Source",
    );
    const missingContentFields = requiredContentFields.filter(
      (field) => !fields.includes(field),
    );

    if (missingContentFields.length > 0) {
      plan.blocked.push({
        modelName: spec.modelName,
        reason: `Missing required fields: ${missingContentFields.join(", ")}`,
      });
      continue;
    }

    const currentTemplateNames = Object.keys(templates);
    if (currentTemplateNames.length !== spec.cardTemplates.length) {
      plan.blocked.push({
        modelName: spec.modelName,
        reason: `Expected ${spec.cardTemplates.length} card ${
          spec.cardTemplates.length === 1 ? "template" : "templates"
        }, found ${currentTemplateNames.length}`,
      });
      continue;
    }

    const desiredTemplates: AnkiModelTemplates = {};
    currentTemplateNames.forEach((templateName, index) => {
      const desired = spec.cardTemplates[index]!;
      desiredTemplates[templateName] = {
        Back: desired.Back,
        Front: desired.Front,
      };
    });

    const missingSource = !fields.includes("Source");
    const desired = { css: spec.css ?? "", templates: desiredTemplates };
    if (
      !missingSource &&
      css === desired.css &&
      templatesEqual(templates, desired.templates)
    ) {
      continue;
    }

    plan.changes.push({
      current: { css, fields, templates },
      desired,
      missingSource,
      modelName: spec.modelName,
    });
  }

  return plan;
}

/** Applies a previously inspected plan without recreating any Anki notes. */
export async function applyManagedModelStyle(
  client: AnkiConnectClient,
  plan: ManagedModelStylePlan,
): Promise<void> {
  for (const change of plan.changes) {
    if (change.missingSource) {
      await client.modelFieldAdd(
        change.modelName,
        "Source",
        change.current.fields.length,
      );
    }
    await client.updateModelTemplates(
      change.modelName,
      change.desired.templates,
    );
    await client.updateModelStyling(change.modelName, change.desired.css);
  }
}

function templatesEqual(
  left: AnkiModelTemplates,
  right: AnkiModelTemplates,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
