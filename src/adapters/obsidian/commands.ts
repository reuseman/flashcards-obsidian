import { Notice } from "obsidian";

import type FlashcardsPlugin from "../../plugin.js";
import { ObsidianMarkdownRepository } from "./obsidian-markdown-repository.js";
import { syncCurrentNote } from "../../application/sync-current-note.js";

export function registerPluginCommands(plugin: FlashcardsPlugin): void {
  plugin.addCommand({
    id: "flashcards-sync-current-note",
    name: "Sync flashcards for the current note",
    checkCallback: (checking) => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile) {
        return false;
      }

      if (!checking) {
        void runSync(plugin);
      }

      return true;
    },
  });
}

async function runSync(plugin: FlashcardsPlugin): Promise<void> {
  const repository = new ObsidianMarkdownRepository(plugin.app);
  const result = await syncCurrentNote(repository, plugin.settings);

  if (!result) {
    new Notice("No active markdown note.");
    return;
  }

  const editSuffix = result.editCount > 0 ? ` Applied ${result.editCount} note update(s).` : "";
  new Notice(`Detected ${result.cardCount} candidate cards in ${result.notePath}.${editSuffix}`);
}
