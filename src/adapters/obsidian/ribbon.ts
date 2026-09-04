import { addIcon } from "obsidian";

import type { PluginHost } from "./plugin-host.js";

const ICON_ID = "flashcards-card-stack";
const ICON_SVG = [
  '<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">',
  '<path d="M18 77V27c0-8 6-14 14-14h8"/>',
  '<rect x="36" y="8" width="50" height="84" rx="9"/>',
  '<path d="M50 34h22M50 52h15"/>',
  "</g>",
].join("");

/** Add the current-note sync action to Obsidian's left ribbon. */
export function registerFlashcardsRibbon(
  plugin: PluginHost,
  onClick: () => void,
): HTMLElement {
  addIcon(ICON_ID, ICON_SVG);
  return plugin.addRibbonIcon(
    ICON_ID,
    "Update Anki from current note",
    onClick,
  );
}

export function setRibbonVisibility(
  ribbonElement: HTMLElement,
  visible: boolean,
): void {
  ribbonElement.hidden = !visible;
}
