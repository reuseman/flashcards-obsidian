import { PluginSettingTab, Setting } from "obsidian";

import type { PluginHost } from "./plugin-host.js";

export class FlashcardsSettingTab extends PluginSettingTab {
  constructor(app: PluginHost["app"], private readonly plugin: PluginHost) {
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

    containerEl.createEl("h3", { text: "Reading-mode rendering" });
    containerEl.createEl("p", {
      text:
        "Cosmetic rendering of flashcard syntax in Reading mode and Live " +
        "Preview. Live Preview toggles take effect after reopening the file.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Enable render-preview")
      .setDesc("Master switch.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.renderPreview.enabled)
          .onChange(async (value) => {
            await this.plugin.updateSettings({
              renderPreview: {
                ...this.plugin.settings.renderPreview,
                enabled: value,
              },
            });
          }),
      );

    const featureRow = (
      key: "cloze" | "anchor" | "inlineSeparator" | "legacyHashtag",
      name: string,
      desc: string,
    ) =>
      new Setting(containerEl).setName(name).setDesc(desc).addToggle((t) =>
        t
          .setValue(this.plugin.settings.renderPreview.features[key])
          .onChange(async (value) => {
            await this.plugin.updateSettings({
              renderPreview: {
                ...this.plugin.settings.renderPreview,
                features: {
                  ...this.plugin.settings.renderPreview.features,
                  [key]: value,
                },
              },
            });
          }),
      );

    featureRow("cloze", "Cloze", "Render {{cN::x}} and {N:x} with cloze styling.");
    featureRow("anchor", "Sync anchor", "Dim the ^q-XXXX / ^XXXXXXXXXXXXX sync anchors.");
    featureRow(
      "inlineSeparator",
      "Inline separator",
      "Replace :: and ::: with arrow glyphs. Off by default (visually invasive).",
    );
    featureRow(
      "legacyHashtag",
      "Legacy hashtag",
      "Fade legacy #card / #card-reverse tags during v1 migration.",
    );
  }
}
