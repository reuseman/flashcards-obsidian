import {
  PluginSettingTab,
  SecretComponent,
  type SettingDefinitionItem,
} from "obsidian";

import {
  DEFAULT_SETTINGS,
  type ContextStrategy,
} from "../../core/config/settings.js";
import type { PluginHost } from "./plugin-host.js";

type SettingsKey =
  | "confirmBeforeDelete"
  | "contextSeparator"
  | "contextStrategy"
  | "defaultDeck"
  | "folderBasedDecks"
  | "folderBasedTags"
  | "folderDeckPrefix"
  | "highlightCloze.enabled"
  | "inline.enabled"
  | "renderPreview.anchor"
  | "renderPreview.cloze"
  | "renderPreview.enabled"
  | "renderPreview.hashtag"
  | "renderPreview.inlineSeparator";

function isContextStrategy(value: unknown): value is ContextStrategy {
  return value === "headings" || value === "none" || value === "note-title";
}

export class FlashcardsSettingTab extends PluginSettingTab {
  constructor(app: PluginHost["app"], private readonly plugin: PluginHost) {
    super(app, plugin);
  }

  override getSettingDefinitions(): SettingDefinitionItem<SettingsKey>[] {
    return [
      {
        type: "group",
        heading: "Flashcards v2",
        items: [
          {
            name: "Default deck",
            desc: "Deck used when a note does not set one. Default: Default.",
            control: {
              type: "text",
              key: "defaultDeck",
              defaultValue: DEFAULT_SETTINGS.defaultDeck,
              validate: (value) =>
                value.trim() ? undefined : "Enter a deck name.",
            },
          },
          {
            name: "Context",
            desc: "Text shown above the active review question. Default: headings.",
            control: {
              type: "dropdown",
              key: "contextStrategy",
              defaultValue: DEFAULT_SETTINGS.contextStrategy,
              options: {
                headings: "Headings (default)",
                none: "None",
                "note-title": "Note title",
              },
            },
          },
          {
            name: "Folder decks",
            desc: "Use the note folder as its deck when cards-deck is not set. Default: on.",
            control: {
              type: "toggle",
              key: "folderBasedDecks",
              defaultValue: DEFAULT_SETTINGS.folderBasedDecks,
            },
          },
          {
            name: "Folder deck prefix",
            desc: "Optional parent for folder-derived decks. It does not change cards-deck. Default: empty.",
            control: {
              type: "text",
              key: "folderDeckPrefix",
              defaultValue: DEFAULT_SETTINGS.folderDeckPrefix,
            },
          },
          {
            name: "Folder tags",
            desc: "Add one hierarchical tag from the note folder. Default: off.",
            control: {
              type: "toggle",
              key: "folderBasedTags",
              defaultValue: DEFAULT_SETTINGS.folderBasedTags,
            },
          },
          {
            name: "Context separator",
            desc: "Text between nested context parts. Use \\n for a new line. Default: >.",
            control: {
              type: "text",
              key: "contextSeparator",
              defaultValue: DEFAULT_SETTINGS.contextSeparator,
            },
          },
          {
            name: "Confirm before deleting",
            desc: "Ask before deleting Anki cards that were removed from a note. Default: on.",
            control: {
              type: "toggle",
              key: "confirmBeforeDelete",
              defaultValue: DEFAULT_SETTINGS.confirmBeforeDelete,
            },
          },
          {
            name: "Inline cards",
            desc: "Create cards from Q :: A and Q ::: A. Default: on.",
            control: {
              type: "toggle",
              key: "inline.enabled",
              defaultValue: DEFAULT_SETTINGS.inline.enabled,
            },
          },
          {
            name: "Highlight clozes",
            desc: "Create clozes from ==text==. Numbered clozes still work when this is off. Default: on.",
            control: {
              type: "toggle",
              key: "highlightCloze.enabled",
              defaultValue: DEFAULT_SETTINGS.highlightCloze.enabled,
            },
          },
          {
            name: "AnkiConnect API key",
            desc: "Optional. Select a secret stored by Obsidian. Default: none.",
            render: (setting) => {
              setting.addComponent((el) =>
                new SecretComponent(this.app, el)
                  .setValue(this.plugin.settings.ankiConnectApiKeySecret)
                  .onChange((value) =>
                    this.plugin.updateSettings({
                      ankiConnectApiKeySecret: value,
                    }),
                  ),
              );
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Reading-mode rendering",
        items: [
          {
            name: "Render flashcard syntax",
            desc: "Style card syntax in Reading mode and Live Preview. Default: on.",
            control: {
              type: "toggle",
              key: "renderPreview.enabled",
              defaultValue: DEFAULT_SETTINGS.renderPreview.enabled,
            },
          },
          {
            name: "Cloze",
            desc: "Style {{cN::text}} and {N:text}. Default: on.",
            control: {
              type: "toggle",
              key: "renderPreview.cloze",
              defaultValue: DEFAULT_SETTINGS.renderPreview.features.cloze,
            },
          },
          {
            name: "Sync anchor",
            desc: "Dim ^q-XXXX and ^XXXXXXXXXXXXX anchors. Default: on.",
            control: {
              type: "toggle",
              key: "renderPreview.anchor",
              defaultValue: DEFAULT_SETTINGS.renderPreview.features.anchor,
            },
          },
          {
            name: "Inline separator",
            desc: "Show :: and ::: as arrows. Default: off.",
            control: {
              type: "toggle",
              key: "renderPreview.inlineSeparator",
              defaultValue: DEFAULT_SETTINGS.renderPreview.features.inlineSeparator,
            },
          },
          {
            name: "Hashtag card",
            desc: "Style #card, #card-reverse, and #card-reminder tags. Default: on.",
            control: {
              type: "toggle",
              key: "renderPreview.hashtag",
              defaultValue: DEFAULT_SETTINGS.renderPreview.features.hashtag,
            },
          },
        ],
      },
    ];
  }

  override getControlValue(key: SettingsKey): unknown {
    switch (key) {
      case "confirmBeforeDelete":
      case "contextSeparator":
      case "contextStrategy":
      case "defaultDeck":
      case "folderBasedDecks":
      case "folderBasedTags":
      case "folderDeckPrefix":
        return this.plugin.settings[key];
      case "highlightCloze.enabled":
        return this.plugin.settings.highlightCloze.enabled;
      case "inline.enabled":
        return this.plugin.settings.inline.enabled;
      case "renderPreview.enabled":
        return this.plugin.settings.renderPreview.enabled;
      case "renderPreview.anchor":
        return this.plugin.settings.renderPreview.features.anchor;
      case "renderPreview.cloze":
        return this.plugin.settings.renderPreview.features.cloze;
      case "renderPreview.hashtag":
        return this.plugin.settings.renderPreview.features.hashtag;
      case "renderPreview.inlineSeparator":
        return this.plugin.settings.renderPreview.features.inlineSeparator;
    }
  }

  override async setControlValue(key: SettingsKey, value: unknown): Promise<void> {
    switch (key) {
      case "defaultDeck":
        if (typeof value === "string" && value.trim()) {
          await this.plugin.updateSettings({ defaultDeck: value.trim() });
        }
        return;
      case "contextStrategy":
        if (isContextStrategy(value)) {
          await this.plugin.updateSettings({ contextStrategy: value });
        }
        return;
      case "contextSeparator":
        if (typeof value === "string") {
          await this.plugin.updateSettings({ contextSeparator: value });
        }
        return;
      case "confirmBeforeDelete":
        if (typeof value === "boolean") {
          await this.plugin.updateSettings({ confirmBeforeDelete: value });
        }
        return;
      case "folderBasedDecks":
      case "folderBasedTags":
        if (typeof value === "boolean") {
          await this.plugin.updateSettings({ [key]: value });
        }
        return;
      case "folderDeckPrefix":
        if (typeof value === "string") {
          await this.plugin.updateSettings({ folderDeckPrefix: value.trim() });
        }
        return;
      case "highlightCloze.enabled":
        if (typeof value === "boolean") {
          await this.plugin.updateSettings({
            highlightCloze: {
              ...this.plugin.settings.highlightCloze,
              enabled: value,
            },
          });
        }
        return;
      case "inline.enabled":
        if (typeof value === "boolean") {
          await this.plugin.updateSettings({
            inline: { ...this.plugin.settings.inline, enabled: value },
          });
        }
        return;
      case "renderPreview.enabled":
        if (typeof value === "boolean") {
          await this.plugin.updateSettings({
            renderPreview: { ...this.plugin.settings.renderPreview, enabled: value },
          });
        }
        return;
      case "renderPreview.anchor":
        return this.updateRenderPreviewFeature("anchor", value);
      case "renderPreview.cloze":
        return this.updateRenderPreviewFeature("cloze", value);
      case "renderPreview.hashtag":
        return this.updateRenderPreviewFeature("hashtag", value);
      case "renderPreview.inlineSeparator":
        return this.updateRenderPreviewFeature("inlineSeparator", value);
    }
  }

  private async updateRenderPreviewFeature(
    key: keyof PluginHost["settings"]["renderPreview"]["features"],
    value: unknown,
  ): Promise<void> {
    if (typeof value !== "boolean") {
      return;
    }

    await this.plugin.updateSettings({
      renderPreview: {
        ...this.plugin.settings.renderPreview,
        features: {
          ...this.plugin.settings.renderPreview.features,
          [key]: value,
        },
      },
    });
  }
}
