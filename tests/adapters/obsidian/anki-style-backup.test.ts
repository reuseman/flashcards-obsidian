import { describe, expect, it, vi } from "vitest";

import { writeAnkiStyleBackup } from "../../../src/adapters/obsidian/anki-style-backup.js";
import type { ManagedModelStylePlan } from "../../../src/adapters/anki/manage-managed-model-style.js";

describe("writeAnkiStyleBackup", () => {
  it("writes the exact current model configuration to a timestamped plugin backup", async () => {
    const mkdir = vi.fn<(path: string) => Promise<void>>(async () => undefined);
    const write = vi.fn<(path: string, data: string) => Promise<void>>(
      async () => undefined,
    );
    const adapter = {
      exists: vi.fn(async () => false),
      mkdir,
      write,
    };
    const plan: ManagedModelStylePlan = {
      blocked: [],
      changes: [
        {
          current: {
            css: ".card { color: hotpink; }",
            fields: ["Front", "Back"],
            templates: {
              "My card": { Back: "{{Back}}", Front: "{{Front}}" },
            },
          },
          desired: { css: "new", templates: {} },
          missingSource: true,
          modelName: "Obsidian-basic",
        },
      ],
    };

    const path = await writeAnkiStyleBackup({
      adapter,
      now: new Date("2026-09-03T20:15:30.123Z"),
      plan,
      pluginDirectory: ".obsidian/plugins/flashcards-obsidian",
      pluginVersion: "2.0.0",
    });

    expect(path).toBe(
      ".obsidian/plugins/flashcards-obsidian/backups/anki-style-2026-09-03T20-15-30-123Z.json",
    );
    expect(mkdir).toHaveBeenCalledWith(
      ".obsidian/plugins/flashcards-obsidian/backups",
    );
    const saved = JSON.parse(write.mock.calls[0]![1] as string);
    expect(saved).toEqual({
      createdAt: "2026-09-03T20:15:30.123Z",
      formatVersion: 1,
      models: [
        {
          css: ".card { color: hotpink; }",
          fields: ["Front", "Back"],
          modelName: "Obsidian-basic",
          templates: {
            "My card": { Back: "{{Back}}", Front: "{{Front}}" },
          },
        },
      ],
      pluginVersion: "2.0.0",
    });
  });
});
