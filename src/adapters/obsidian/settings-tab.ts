import { PluginSettingTab, Setting } from "obsidian";

import type FlashcardsPlugin from "../../plugin.js";

export class FlashcardsSettingTab extends PluginSettingTab {
  constructor(app: FlashcardsPlugin["app"], private readonly plugin: FlashcardsPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Flashcards v2" });

    new Setting(containerEl)
      .setName("Default deck")
      .setDesc("Fallback deck name when a note does not override it.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.defaultDeck)
          .onChange(async (value) => {
            if (!value.trim()) {
              return;
            }

            await this.plugin.updateSettings({ defaultDeck: value.trim() });
          }),
      );

    new Setting(containerEl)
      .setName("Context strategy")
      .setDesc("How heading context is added to generated card fronts.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("headings", "Headings")
          .addOption("none", "None")
          .addOption("note-title", "Note title")
          .setValue(this.plugin.settings.contextStrategy)
          .onChange(async (value) => {
            await this.plugin.updateSettings({
              contextStrategy: value as typeof this.plugin.settings.contextStrategy,
            });
          }),
      );
  }
}
