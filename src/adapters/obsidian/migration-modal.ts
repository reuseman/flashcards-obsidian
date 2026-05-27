import { Modal, Setting, type App } from "obsidian";

export interface MigrationModalOptions {
  affectedNoteCount: number;
  onCancel: () => void;
  onMigrate: () => void;
  onSkip: () => void;
  unmigratedCount: number;
}

export class MigrationModal extends Modal {
  private readonly options: MigrationModalOptions;

  constructor(app: App, options: MigrationModalOptions) {
    super(app);
    this.options = options;
  }

  override onOpen(): void {
    this.setTitle("Migrate flashcards from a previous version?");

    const { unmigratedCount, affectedNoteCount } = this.options;
    const noteWord = affectedNoteCount === 1 ? "note" : "notes";
    const cardWord = unmigratedCount === 1 ? "flashcard" : "flashcards";

    this.contentEl.createEl("p", {
      text:
        `Found ${unmigratedCount} ${cardWord} in ${affectedNoteCount} ${noteWord} that were ` +
        `created by an older version of this plugin. They sync to Anki normally, but the ` +
        `plugin can't currently detect when you edit them locally — so your changes won't ` +
        `reach Anki until they're migrated.`,
    });

    this.contentEl.createEl("p", {
      text:
        `Migration is a one-time local change: a small entry is added to each note's ` +
        `frontmatter. Nothing is sent to Anki by this step.`,
    });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Migrate and continue")
          .setTooltip(
            `Add frontmatter entries for all ${unmigratedCount} ${cardWord}, then continue syncing.`,
          )
          .setCta()
          .onClick(() => {
            this.options.onMigrate();
            this.close();
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Sync without migrating")
          .setTooltip(
            "Continue syncing now and stop showing this prompt. Cards still sync to Anki, but " +
              "edits made locally won't be detected as updates.",
          )
          .onClick(() => {
            this.options.onSkip();
            this.close();
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Cancel")
          .setTooltip("Abort this sync. You'll be asked again next time.")
          .onClick(() => {
            this.options.onCancel();
            this.close();
          }),
      );
  }

  override onClose(): void {
    // no-op
  }
}
