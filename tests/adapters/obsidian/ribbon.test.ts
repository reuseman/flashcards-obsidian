import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginHost } from "../../../src/adapters/obsidian/plugin-host.js";

const obsidian = vi.hoisted(() => ({ addIcon: vi.fn() }));

vi.mock("obsidian", () => ({
  addIcon: obsidian.addIcon,
  Notice: class {},
}));

import {
  registerFlashcardsRibbon,
  setRibbonVisibility,
} from "../../../src/adapters/obsidian/ribbon.js";

describe("flashcards ribbon", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers a stacked-card current-note action", () => {
    const element = { hidden: false } as HTMLElement;
    const addRibbonIcon = vi.fn(() => element);
    const plugin = { addRibbonIcon } as unknown as PluginHost;
    const onClick = vi.fn();

    expect(registerFlashcardsRibbon(plugin, onClick)).toBe(element);
    expect(obsidian.addIcon).toHaveBeenCalledWith(
      "flashcards-card-stack",
      expect.stringMatching(/stroke="currentColor".*<rect x="36"/),
    );
    expect(addRibbonIcon).toHaveBeenCalledWith(
      "flashcards-card-stack",
      "Update Anki from current note",
      onClick,
    );
  });

  it("shows and hides the registered element", () => {
    const element = { hidden: false } as HTMLElement;

    setRibbonVisibility(element, false);
    expect(element.hidden).toBe(true);

    setRibbonVisibility(element, true);
    expect(element.hidden).toBe(false);
  });
});
