import type { Plugin } from "obsidian";

import type { FlashcardsSettings } from "../core/config/settings.js";
import { renderPreviewExtension } from "./adapters/live-preview.js";
import { applyReadingMode } from "./adapters/reading-mode.js";
import { buildRegistry } from "./registry.js";

/**
 * Register reading-mode post-processor and live-preview CM6 extension.
 *
 * The reading-mode post-processor reads the *current* registry on every render
 * call, so settings changes take effect on the next preview repaint.
 *
 * The live-preview CM6 extension is built once at onload with the initial
 * registry; settings changes that affect Live Preview require a workspace
 * reload to take effect. This is surfaced in the settings-tab copy.
 */
export function registerRenderPreview(
  plugin: Plugin,
  getSettings: () => FlashcardsSettings,
): void {
  plugin.registerMarkdownPostProcessor((el) => {
    const features = buildRegistry(getSettings());
    if (features.length > 0) applyReadingMode(el as HTMLElement, features);
  });

  plugin.registerEditorExtension(
    renderPreviewExtension(buildRegistry(getSettings())),
  );
}
