import { Modal, Setting, type App } from "obsidian";

import type { ManagedModelStylePlan } from "../anki/manage-managed-model-style.js";

export function createAnkiStyleConfirmer(
  app: App,
): (plan: ManagedModelStylePlan) => Promise<boolean> {
  return (plan) =>
    new Promise<boolean>((resolve) => {
      new AnkiStyleConfirmModal(app, plan, resolve).open();
    });
}

class AnkiStyleConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly plan: ManagedModelStylePlan,
    private readonly resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const count = this.plan.changes.length;
    this.setTitle("Apply the v2 Anki card style?");
    this.contentEl.createEl("p", {
      text:
        `This will replace the templates and CSS of ${count} managed Anki ${
          count === 1 ? "model" : "models"
        }. Every card using those shared models will use the new appearance. ` +
        "Existing cards will keep their IDs, review history, and scheduling.",
    });
    this.contentEl.createEl("p", {
      text:
        "The exact current fields, templates, and CSS will be saved as a JSON backup before Anki is changed.",
    });

    const changes = this.contentEl.createEl("ul");
    for (const change of this.plan.changes) {
      const addedFields = [
        ...(change.missingContext ? ["Context"] : []),
        ...(change.missingSource ? ["Source"] : []),
      ];
      changes.createEl("li", {
        text: `${change.modelName}${
          addedFields.length > 0
            ? ` — adds ${addedFields.join(" and ")} ${
                addedFields.length === 1 ? "field" : "fields"
              }`
            : ""
        }`,
      });
    }

    if (this.plan.blocked.length > 0) {
      this.contentEl.createEl("p", {
        text: "These incompatible models will be skipped:",
      });
      const blocked = this.contentEl.createEl("ul");
      for (const item of this.plan.blocked) {
        blocked.createEl("li", {
          text: `${item.modelName} — ${item.reason}`,
        });
      }
    }

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("Apply v2 style")
          .setCta()
          .onClick(() => this.finish(true)),
      )
      .addButton((button) =>
        button
          .setButtonText("Keep current style")
          .onClick(() => this.finish(false)),
      );
  }

  override onClose(): void {
    this.finish(false);
  }

  private finish(confirmed: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(confirmed);
    this.close();
  }
}
