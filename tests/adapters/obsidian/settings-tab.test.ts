import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import type { PluginHost } from "../../../src/adapters/obsidian/plugin-host.js";

vi.mock("obsidian", () => ({
  PluginSettingTab: class {
    constructor(_app: unknown, _plugin: unknown) {}
  },
}));

import { FlashcardsSettingTab } from "../../../src/adapters/obsidian/settings-tab.js";

describe("FlashcardsSettingTab", () => {
  let host: PluginHost;
  let tab: FlashcardsSettingTab;

  beforeEach(() => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const updateSettings = vi.fn(async (next) => {
      host.settings = { ...host.settings, ...next };
    });

    host = {
      app: {},
      settings,
      updateSettings,
    } as unknown as PluginHost;
    tab = new FlashcardsSettingTab(host.app, host);
  });

  it("declares the settings with explicit defaults", () => {
    expect(tab.getSettingDefinitions()).toEqual([
      expect.objectContaining({
        type: "group",
        heading: "Flashcards v2",
        items: expect.arrayContaining([
          expect.objectContaining({
            name: "Default deck",
            control: expect.objectContaining({
              type: "text",
              key: "defaultDeck",
              defaultValue: "Default",
            }),
          }),
          expect.objectContaining({
            name: "Context",
            control: expect.objectContaining({
              type: "dropdown",
              key: "contextStrategy",
              defaultValue: "headings",
            }),
          }),
          expect.objectContaining({
            name: "Context separator",
            control: expect.objectContaining({
              type: "text",
              key: "contextSeparator",
              defaultValue: " > ",
            }),
          }),
        ]),
      }),
      expect.objectContaining({
        type: "group",
        heading: "Reading-mode rendering",
        items: expect.arrayContaining([
          expect.objectContaining({
            name: "Inline separator",
            control: expect.objectContaining({
              type: "toggle",
              key: "renderPreview.inlineSeparator",
              defaultValue: false,
            }),
          }),
        ]),
      }),
    ]);
  });

  it("reads current values through declarative control keys", () => {
    host.settings.defaultDeck = "Study";
    host.settings.renderPreview.features.cloze = false;

    expect(tab.getControlValue("defaultDeck")).toBe("Study");
    expect(tab.getControlValue("renderPreview.cloze")).toBe(false);
  });

  it("persists top-level and nested control changes", async () => {
    await tab.setControlValue("defaultDeck", "  Study  ");
    await tab.setControlValue("contextStrategy", "note-title");
    await tab.setControlValue("contextSeparator", " / ");
    await tab.setControlValue("renderPreview.cloze", false);

    expect(host.settings.defaultDeck).toBe("Study");
    expect(host.settings.contextStrategy).toBe("note-title");
    expect(host.settings.contextSeparator).toBe(" / ");
    expect(host.settings.renderPreview.features).toEqual({
      ...DEFAULT_SETTINGS.renderPreview.features,
      cloze: false,
    });
    expect(host.updateSettings).toHaveBeenCalledTimes(4);
  });

  it("ignores values that do not match the control type", async () => {
    await tab.setControlValue("defaultDeck", "   ");
    await tab.setControlValue("contextStrategy", "invalid");
    await tab.setControlValue("renderPreview.enabled", "yes");

    expect(host.updateSettings).not.toHaveBeenCalled();
  });
});
