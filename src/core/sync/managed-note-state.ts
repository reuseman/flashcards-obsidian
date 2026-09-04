import type { IdentifiedFlashcard } from "../domain/card.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
  ANKI_MODEL_REVERSED,
} from "../render/render-card.js";

export function desiredManagedModel(card: IdentifiedFlashcard): string {
  if (card.kind === "cloze") return ANKI_MODEL_CLOZE;
  if (card.kind === "reminder") return ANKI_MODEL_REMINDER;
  if (card.kind === "reversed") return ANKI_MODEL_REVERSED;
  return ANKI_MODEL_BASIC;
}

export function crossesClozeBoundary(
  fromModel: string,
  toModel: string,
): boolean {
  return (fromModel === ANKI_MODEL_CLOZE) !== (toModel === ANKI_MODEL_CLOZE);
}

function managedFieldNames(modelName: string): string[] {
  if (modelName === ANKI_MODEL_REMINDER) {
    return ["Content", "Context", "Source"];
  }
  return modelName === ANKI_MODEL_CLOZE
    ? ["Text", "Extra", "Context", "Source"]
    : ["Front", "Back", "Context", "Source"];
}

export function readManagedFields(
  fields: Record<string, { order?: number; value?: string }> | undefined,
  modelName: string,
): Record<string, string> | undefined {
  if (fields === undefined) return undefined;
  return Object.fromEntries(
    managedFieldNames(modelName).map((name) => [
      name,
      fields[name]?.value ?? "",
    ]),
  );
}
