import { Notice, Plugin } from "obsidian";

import { registerPluginCommands } from "./adapters/obsidian/commands.js";
import { FlashcardsSettingTab } from "./adapters/obsidian/settings-tab.js";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type FlashcardsSettings,
} from "./core/config/settings.js";

export default class FlashcardsPlugin extends Plugin {
  settings: FlashcardsSettings = DEFAULT_SETTINGS;

  override async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());

    this.addSettingTab(new FlashcardsSettingTab(this.app, this));
    registerPluginCommands(this);

    new Notice("Flashcards v2 scaffold loaded.");
  }

  override async onunload(): Promise<void> {
    await this.saveData(this.settings);
  }

  async updateSettings(next: Partial<FlashcardsSettings>): Promise<void> {
    this.settings = { ...this.settings, ...next };
    await this.saveData(this.settings);
  }
}
