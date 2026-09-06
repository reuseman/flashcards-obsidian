import { Notice } from "obsidian";

import type { PluginHost } from "./plugin-host.js";
import { AnkiConnectClient } from "../anki/anki-connect-client.js";
import { repairManagedSourceTemplates } from "../anki/repair-managed-source-templates.js";
import {
  applyManagedModelStyle,
  inspectManagedModelStyle,
} from "../anki/manage-managed-model-style.js";
import { uploadMedia } from "../anki/upload-media.js";
import { ObsidianMarkdownRepository } from "./obsidian-markdown-repository.js";
import { MigrationModal } from "./migration-modal.js";
import { SyntaxMigrationModal } from "./syntax-migration-modal.js";
import { createDeleteConfirmer } from "./delete-confirm-modal.js";
import { createKindRecreationConfirmer } from "./kind-recreation-confirm-modal.js";
import { createAnkiStyleConfirmer } from "./anki-style-confirm-modal.js";
import { writeAnkiStyleBackup } from "./anki-style-backup.js";
import { prepareIncrementalVaultSync } from "./incremental-vault-sync.js";
import { obsidianAnkiConnectTransport } from "./anki-connect-transport.js";
import { buildMediaRewriteMap, resolveMedia } from "./media-resolver.js";
import { createWikilinkResolver } from "./wikilink-resolver.js";
import { backfillV1Vault } from "../../application/backfill-v1-vault.js";
import { migrationCheck } from "../../application/migration-check.js";
import { buildSyntaxMigrationReport } from "../../application/build-syntax-migration-report.js";
import {
  syncNote,
  type MediaPipeline,
  type SyncNoteResult,
} from "../../application/sync-note.js";
import {
  syncVault,
  type SyncVaultResult,
} from "../../application/sync-vault.js";
import type { SyncExecutionSession } from "../../application/ports.js";

type Target = "current" | "vault";

export interface PluginActions {
  updateAnkiFromCurrentNote: () => void;
}

export function registerPluginCommands(plugin: PluginHost): PluginActions {
  const updateAnkiFromCurrentNote = (): void => {
    const activeFile = plugin.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("Open a Markdown note before updating Anki.");
      return;
    }
    void runWithMigrationCheck(plugin, "current");
  };

  plugin.addCommand({
    callback: () => {
      void runAnkiStyleMigration(plugin);
    },
    id: "flashcards-apply-v2-anki-style",
    name: "Apply v2 Anki card style",
  });

  plugin.addCommand({
    callback: () => {
      void showSyntaxMigrationReport(plugin);
    },
    id: "flashcards-check-v2-syntax",
    name: "Check vault for v2 syntax migration",
  });

  plugin.addCommand({
    checkCallback: (checking) => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile || activeFile.extension !== "md") return false;
      if (!checking) updateAnkiFromCurrentNote();
      return true;
    },
    id: "flashcards-sync-current-note",
    name: "Update Anki from current note",
  });

  plugin.addCommand({
    callback: () => {
      void runWithMigrationCheck(plugin, "vault");
    },
    id: "flashcards-sync-vault",
    name: "Update Anki from vault",
  });

  return { updateAnkiFromCurrentNote };
}

async function runAnkiStyleMigration(plugin: PluginHost): Promise<void> {
  if (plugin.syncInFlight) {
    new Notice("Sync already in progress.");
    return;
  }

  plugin.syncInFlight = true;
  let backupPath: string | undefined;
  let stage: "apply" | "backup" | "inspect" = "inspect";
  try {
    const ankiClient = createAnkiClient(plugin);
    const plan = await inspectManagedModelStyle(ankiClient);
    if (plan.changes.length === 0) {
      if (plan.blocked.length === 0) {
        new Notice("Managed Anki models already use the v2 style.");
      } else {
        new Notice(
          `No compatible managed Anki models to update. ${plan.blocked
            .map((item) => `${item.modelName}: ${item.reason}`)
            .join("; ")}`,
        );
      }
      return;
    }

    const confirmed = await createAnkiStyleConfirmer(plugin.app)(plan);
    if (!confirmed) return;

    const pluginDirectory =
      plugin.manifest.dir ??
      `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
    stage = "backup";
    backupPath = await writeAnkiStyleBackup({
      adapter: plugin.app.vault.adapter,
      plan,
      pluginDirectory,
      pluginVersion: plugin.manifest.version,
    });
    stage = "apply";
    await applyManagedModelStyle(ankiClient, plan);

    const count = plan.changes.length;
    new Notice(
      `Applied v2 style to ${count} Anki ${
        count === 1 ? "model" : "models"
      }. Backup: ${backupPath}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    plugin.logger.error("Anki style migration failed", { error: message });
    if (stage === "inspect") {
      new Notice(`Anki style check failed: ${message}`);
    } else if (stage === "backup") {
      new Notice(`Anki style backup failed: ${message}. Anki was not changed.`);
    } else {
      new Notice(`Anki style update failed: ${message}. Backup: ${backupPath}`);
    }
  } finally {
    plugin.syncInFlight = false;
    plugin.refreshStatusBars();
  }
}

function createAnkiClient(plugin: PluginHost): AnkiConnectClient {
  const secretName = plugin.settings.ankiConnectApiKeySecret;
  const apiKey = secretName
    ? (plugin.app.secretStorage.getSecret(secretName) ?? undefined)
    : undefined;
  return new AnkiConnectClient({
    ...(apiKey ? { apiKey } : {}),
    transport: obsidianAnkiConnectTransport,
  });
}

async function showSyntaxMigrationReport(plugin: PluginHost): Promise<void> {
  try {
    const repository = new ObsidianMarkdownRepository(plugin.app);
    const items = buildSyntaxMigrationReport(
      await repository.getAllMarkdownNotes(),
    );
    if (items.length === 0) {
      new Notice("No Flashcards v2 syntax migrations found.");
      return;
    }
    new SyntaxMigrationModal(plugin.app, {
      items,
      onOpenLocation: (item) => {
        void (async () => {
          await plugin.app.workspace.openLinkText(item.notePath, "", false);
          plugin.app.workspace.activeEditor?.editor?.setCursor({
            ch: Math.max(0, item.column - 1),
            line: Math.max(0, item.line - 1),
          });
        })();
      },
    }).open();
  } catch (error) {
    new Notice(
      `Syntax migration check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function runWithMigrationCheck(
  plugin: PluginHost,
  target: Target,
): Promise<void> {
  if (plugin.syncInFlight) {
    new Notice("Sync already in progress.");
    return;
  }
  const repository = new ObsidianMarkdownRepository(plugin.app);
  const ankiClient = createAnkiClient(plugin);
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

function createMediaPipeline(
  plugin: PluginHost,
  ankiClient: AnkiConnectClient,
): MediaPipeline {
  return async (refs, sourcePath) => {
    const resolution = await resolveMedia(plugin.app, sourcePath, refs);
    return {
      rewriteMap: buildMediaRewriteMap(refs, resolution.resolved),
      errors: resolution.errors.map((e) => ({
        filename: e.filename,
        reason: e.reason,
      })),
      upload: () => uploadMedia(ankiClient, resolution.resolved.values()),
    };
  };
}

async function dispatch(
  plugin: PluginHost,
  repository: ObsidianMarkdownRepository,
  ankiClient: AnkiConnectClient,
  vaultName: string,
  target: Target,
): Promise<void> {
  const resolveLink = createWikilinkResolver(plugin.app.metadataCache);
  const mediaPipeline = createMediaPipeline(plugin, ankiClient);
  const confirmDeletions = plugin.settings.confirmBeforeDelete
    ? createDeleteConfirmer(plugin.app, ankiClient)
    : undefined;
  const confirmKindRecreations = createKindRecreationConfirmer(plugin.app);
  const executionSession: SyncExecutionSession = {};
  try {
    const repair = await repairManagedSourceTemplates(
      ankiClient,
      executionSession,
    );
    if (repair.templatesUpdated > 0) {
      new Notice(
        `Updated ${repair.templatesUpdated} Anki ${
          repair.templatesUpdated === 1 ? "template" : "templates"
        } to show managed Context or Source fields.`,
      );
    }
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
          ...(confirmDeletions ? { confirmDeletions } : {}),
          confirmKindRecreations,
          executionSession,
          logger: plugin.logger,
          mediaPipeline,
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
        const pluginDirectory =
          plugin.manifest.dir ??
          `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
        const incremental = await prepareIncrementalVaultSync({
          adapter: plugin.app.vault.adapter,
          ankiClient,
          indexPath: `${pluginDirectory}/vault-scan-index.json`,
          repository,
          settingsKey: JSON.stringify({
            pluginVersion: plugin.manifest.version,
            settings: plugin.settings,
            vaultName,
          }),
        });
        result = await syncVault({
          ankiClient,
          cachedAtomicCues: incremental.cachedAtomicCues,
          ...(confirmDeletions ? { confirmDeletions } : {}),
          confirmKindRecreations,
          executionSession,
          logger: plugin.logger,
          mediaPipeline,
          notes: incremental.notes,
          onProgress: (current, total, notePath) => {
            const name = notePath.split("/").pop() ?? notePath;
            statusBar.setText(`Flashcards: ${current}/${total} — ${name}`);
          },
          repository,
          resolveLink,
          settings: plugin.settings,
          processedNoteCount: incremental.processedNoteCount,
          skippedUnchangedNoteCount: incremental.skippedUnchangedNoteCount,
          vaultName,
        });
        try {
          await incremental.finish(result.perNote);
        } catch (error) {
          plugin.logger.warn("Could not save disposable vault scan index", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
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
    failedOps > 0
      ? ` (${failedOps} card op${failedOps === 1 ? "" : "s"} failed — see sync.log)`
      : "";
  const recovered = result.recoveredMissingCount;
  const recoveredSuffix =
    recovered > 0
      ? ` (${recovered} missing Anki card${recovered === 1 ? "" : "s"} recreated)`
      : "";
  return `Synced ${result.notePath}: +${creates} ~${updates} -${deletes}${recoveredSuffix}${failedSuffix}`;
}

function summarizeVault(result: SyncVaultResult): string {
  const failedOps = result.perNote.reduce(
    (sum, r) => sum + countFailedOps(r.ankiResults),
    0,
  );
  const parts: string[] = [];
  if (result.failedNotes > 0)
    parts.push(
      `${result.failedNotes} note${result.failedNotes === 1 ? "" : "s"} failed`,
    );
  if (failedOps > 0)
    parts.push(`${failedOps} card op${failedOps === 1 ? "" : "s"} failed`);
  const failedSuffix =
    parts.length > 0 ? ` (${parts.join(", ")} — see sync.log)` : "";
  return (
    `Vault sync: ${result.noteCount} notes` +
    (result.skippedUnchangedNoteCount > 0
      ? ` (${result.skippedUnchangedNoteCount} unchanged verified notes skipped)`
      : "") +
    ", " +
    `+${result.totalCreates} ~${result.totalUpdates} -${result.totalDeletes}${failedSuffix}`
  );
}
