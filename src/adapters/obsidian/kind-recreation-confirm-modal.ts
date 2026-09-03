import { Modal, Setting, type App } from "obsidian";

import type { PendingKindRecreation } from "../../core/sync/sync-plan.js";

export function createKindRecreationConfirmer(
  app: App,
): (pending: PendingKindRecreation[]) => Promise<boolean> {
  return (pending) =>
    new Promise<boolean>((resolve) => {
      new KindRecreationConfirmModal(app, pending, resolve).open();
    });
}

class KindRecreationConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly pending: PendingKindRecreation[],
    private readonly resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const count = this.pending.length;
    const cardWord = count === 1 ? "card" : "cards";
    this.setTitle(`Recreate ${count} Anki ${cardWord}?`);

    this.contentEl.createEl("p", {
      text:
        `These ${cardWord} changed between cloze and basic or reversed. ` +
        "Anki cannot convert this safely. Recreating them gives them new IDs " +
        "and removes their review history.",
    });

    const list = this.contentEl.createEl("ul");
    for (const item of this.pending) {
      list.createEl("li", {
        text: `${item.front} — ${shortModel(item.fromModel)} to ${shortModel(item.toModel)}`,
      });
    }

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("Recreate")
          .setWarning()
          .onClick(() => this.finish(true)),
      )
      .addButton((button) =>
        button
          .setButtonText("Keep unchanged")
          .setCta()
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

function shortModel(modelName: string): string {
  if (modelName.endsWith("basic-reversed")) return "reversed";
  if (modelName.endsWith("cloze")) return "cloze";
  if (modelName.endsWith("basic")) return "basic";
  return modelName;
}
