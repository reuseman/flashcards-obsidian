import { addIcon } from "obsidian";

import type { PluginHost } from "./plugin-host.js";

const ICON_ID = "flashcards-card-stack";
const ICON_SVG = [
  '<path d="M4 18V6a2 2 0 0 1 2-2h2"/>',
  '<rect x="8" y="2" width="12" height="20" rx="2"/>',
  '<path d="M11 7h6M11 11h4"/>',
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
