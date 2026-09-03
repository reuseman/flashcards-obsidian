import { Modal, Setting, type App } from "obsidian";

import type { SyntaxMigrationReportItem } from "../../application/build-syntax-migration-report.js";

export interface SyntaxMigrationModalOptions {
  items: SyntaxMigrationReportItem[];
  onOpenLocation: (item: SyntaxMigrationReportItem) => void;
}

export class SyntaxMigrationModal extends Modal {
  constructor(app: App, private readonly options: SyntaxMigrationModalOptions) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("Flashcards v2 syntax migration report");
    this.contentEl.createEl("p", {
      text:
        `Found ${this.options.items.length} possible migration ${
          this.options.items.length === 1 ? "item" : "items"
        }. This report does not change any note.`,
    });

    for (const item of this.options.items) {
      const setting = new Setting(this.contentEl)
        .setName(`${item.notePath}:${item.line}:${item.column}`)
        .setDesc(`${item.message} ${item.replacement}`);
      setting.addButton((button) =>
        button.setButtonText("Open").onClick(() => {
          this.options.onOpenLocation(item);
        }),
      );
      this.contentEl.createEl("pre", { text: item.snippet });
    }

    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText("Close").onClick(() => this.close()),
    );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
