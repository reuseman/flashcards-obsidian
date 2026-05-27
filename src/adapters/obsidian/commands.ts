import { Notice } from "obsidian";

import type FlashcardsPlugin from "../../plugin.js";
import { AnkiConnectClient } from "../anki/anki-connect-client.js";
import { ObsidianMarkdownRepository } from "./obsidian-markdown-repository.js";
import { MigrationModal } from "./migration-modal.js";
import { createWikilinkResolver } from "./wikilink-resolver.js";
import { backfillV1Vault } from "../../application/backfill-v1-vault.js";
import { migrationCheck } from "../../application/migration-check.js";
import { syncNote, type SyncNoteResult } from "../../application/sync-note.js";
import {
  syncVault,
  type SyncVaultResult,
} from "../../application/sync-vault.js";

type Target = "current" | "vault";

export function registerPluginCommands(plugin: FlashcardsPlugin): void {
  plugin.addCommand({
    checkCallback: (checking) => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile || activeFile.extension !== "md") return false;
      if (!checking) void runWithMigrationCheck(plugin, "current");
      return true;
    },
    id: "flashcards-sync-current-note",
    name: "Sync current note",
  });

  plugin.addCommand({
    callback: () => {
      void runWithMigrationCheck(plugin, "vault");
    },
    id: "flashcards-sync-vault",
    name: "Sync vault",
  });
}

async function runWithMigrationCheck(
  plugin: FlashcardsPlugin,
  target: Target,
): Promise<void> {
  if (plugin.syncInFlight) {
    new Notice("Sync already in progress.");
    return;
  }
  const repository = new ObsidianMarkdownRepository(plugin.app);
  const ankiClient = new AnkiConnectClient();
  const vaultName = plugin.app.vault.getName();

  // Fast path: decision already made → no vault scan.
  if (plugin.settings.v1MigrationDecisionMade) {
    plugin.syncInFlight = true;
    try {
      await dispatch(plugin, repository, ankiClient, vaultName, target);
    } finally {
      plugin.syncInFlight = false;
      plugin.refreshStatusBars();
    }
    return;
  }

  // Scan vault for v1 anchors.
  const notes = await repository.getAllMarkdownNotes();
  const decision = migrationCheck({
    decisionMade: plugin.settings.v1MigrationDecisionMade,
    notes,
  });

  if (decision.decision === "skip") {
    if (!plugin.settings.v1MigrationDecisionMade) {
      await plugin.updateSettings({ v1MigrationDecisionMade: true });
    }
    plugin.syncInFlight = true;
    try {
      await dispatch(plugin, repository, ankiClient, vaultName, target);
    } finally {
      plugin.syncInFlight = false;
      plugin.refreshStatusBars();
    }
    return;
  }

  // decision.decision === "ask"
  const modal = new MigrationModal(plugin.app, {
    affectedNoteCount: decision.affectedNoteCount,
    onCancel: () => {
      new Notice("Sync cancelled.");
    },
    onMigrate: () => {
      void (async () => {
        plugin.syncInFlight = true;
        try {
          try {
            const result = await backfillV1Vault({
              repository,
              settings: plugin.settings,
            });
            new Notice(
              `Migrated ${result.totalBackfilledCount} anchors across ${result.notesUpdated} notes.`,
            );
          } catch (e) {
            new Notice(
              `Migration failed: ${e instanceof Error ? e.message : String(e)}`,
            );
            return;
          }
          await plugin.updateSettings({ v1MigrationDecisionMade: true });
          await dispatch(plugin, repository, ankiClient, vaultName, target);
        } finally {
          plugin.syncInFlight = false;
          plugin.refreshStatusBars();
        }
      })();
    },
    onSkip: () => {
      void (async () => {
        plugin.syncInFlight = true;
        try {
          await plugin.updateSettings({ v1MigrationDecisionMade: true });
          await dispatch(plugin, repository, ankiClient, vaultName, target);
        } finally {
          plugin.syncInFlight = false;
          plugin.refreshStatusBars();
        }
      })();
    },
    unmigratedCount: decision.unmigratedCount,
  });
  modal.open();
}

async function dispatch(
  plugin: FlashcardsPlugin,
  repository: ObsidianMarkdownRepository,
  ankiClient: AnkiConnectClient,
  vaultName: string,
  target: Target,
): Promise<void> {
  const resolveLink = createWikilinkResolver(plugin.app.metadataCache);
  try {
    if (target === "current") {
      const note = await repository.getActiveNote();
      if (!note) {
        new Notice("No active markdown note.");
        return;
      }
      const inProgress = new Notice(`Syncing ${note.path}…`, 0);
      let result: SyncNoteResult;
      try {
        result = await syncNote({
          ankiClient,
          logger: plugin.logger,
          note,
          repository,
          resolveLink,
          settings: plugin.settings,
          vaultName,
        });
      } finally {
        inProgress.hide();
      }
      new Notice(summarizeNote(result));
    } else {
      const statusBar = plugin.addStatusBarItem();
      statusBar.setText("Flashcards: starting…");
      let result: SyncVaultResult;
      try {
        result = await syncVault({
          ankiClient,
          logger: plugin.logger,
          onProgress: (current, total, notePath) => {
            const name = notePath.split("/").pop() ?? notePath;
            statusBar.setText(`Flashcards: ${current}/${total} — ${name}`);
          },
          repository,
          resolveLink,
          settings: plugin.settings,
          vaultName,
        });
      } finally {
        statusBar.remove();
      }
      new Notice(summarizeVault(result));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    plugin.logger.error("dispatch failed", { target, error: msg });
    new Notice(`Sync failed: ${msg}`);
  }
}

function countFailedOps(r: SyncNoteResult["ankiResults"]): number {
  if (!r) return 0;
  return (
    r.creates.filter((c) => c.status === "failed").length +
    r.updates.filter((u) => u.status === "failed").length +
    r.deletes.filter((d) => d.status === "failed").length
  );
}

function summarizeNote(result: SyncNoteResult): string {
  if (result.status === "failed") {
    return `Sync failed: ${result.error ?? "unknown error"} — see sync.log`;
  }
  if (result.status === "skipped") {
    return "No cards detected.";
  }
  const r = result.ankiResults;
  const creates = r ? r.creates.filter((c) => c.status === "ok").length : 0;
  const updates = r ? r.updates.filter((u) => u.status === "ok").length : 0;
  const deletes = r ? r.deletes.filter((d) => d.status === "ok").length : 0;
  const failedOps = countFailedOps(r);
  const failedSuffix =
    failedOps > 0 ? ` (${failedOps} card op${failedOps === 1 ? "" : "s"} failed — see sync.log)` : "";
  return `Synced ${result.notePath}: +${creates} ~${updates} -${deletes}${failedSuffix}`;
}

function summarizeVault(result: SyncVaultResult): string {
  const failedOps = result.perNote.reduce(
    (sum, r) => sum + countFailedOps(r.ankiResults),
    0,
  );
  const parts: string[] = [];
  if (result.failedNotes > 0) parts.push(`${result.failedNotes} note${result.failedNotes === 1 ? "" : "s"} failed`);
  if (failedOps > 0) parts.push(`${failedOps} card op${failedOps === 1 ? "" : "s"} failed`);
  const failedSuffix =
    parts.length > 0 ? ` (${parts.join(", ")} — see sync.log)` : "";
  return (
    `Vault sync: ${result.noteCount} notes, ` +
    `+${result.totalCreates} ~${result.totalUpdates} -${result.totalDeletes}${failedSuffix}`
  );
}
