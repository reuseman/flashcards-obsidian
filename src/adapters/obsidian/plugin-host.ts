import type { Plugin } from "obsidian";

import type { FlashcardsSettings } from "../../core/config/settings.js";
import type { Logger } from "../../core/logging/logger.js";

/**
 * Minimal host contract consumed by Obsidian adapters (commands, settings tab)
 * that need to talk back to the plugin instance. Extends obsidian's `Plugin`
 * so adapters keep access to `app`, `addCommand`, `addStatusBarItem`, and can
 * pass the host to `PluginSettingTab`'s `super(app, plugin)`.
 *
 * Depending on this interface instead of the concrete `FlashcardsPlugin` breaks
 * the type cycle between `plugin.ts` and its adapters. `FlashcardsPlugin`
 * `implements PluginHost`, giving a compile-time guarantee it keeps providing
 * what these consumers use.
 */
export interface PluginHost extends Plugin {
  settings: FlashcardsSettings;
  logger: Logger;
  syncInFlight: boolean;
  updateSettings(next: Partial<FlashcardsSettings>): Promise<void>;
  /** Called by commands after a sync completes. */
  refreshStatusBars(): void;
}
