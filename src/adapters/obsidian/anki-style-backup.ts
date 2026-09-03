import type { ManagedModelStylePlan } from "../anki/manage-managed-model-style.js";

interface BackupAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write(path: string, data: string): Promise<void>;
}

export interface WriteAnkiStyleBackupOptions {
  adapter: BackupAdapter;
  now?: Date;
  plan: ManagedModelStylePlan;
  pluginDirectory: string;
  pluginVersion: string;
}

/** Saves every value needed to restore the affected models before mutation. */
export async function writeAnkiStyleBackup(
  options: WriteAnkiStyleBackupOptions,
): Promise<string> {
  const backupDirectory = `${options.pluginDirectory}/backups`;
  if (!(await options.adapter.exists(backupDirectory))) {
    await options.adapter.mkdir(backupDirectory);
  }

  const now = options.now ?? new Date();
  const timestamp = now.toISOString().replaceAll(":", "-").replace(".", "-");
  const path = `${backupDirectory}/anki-style-${timestamp}.json`;
  const backup = {
    createdAt: now.toISOString(),
    formatVersion: 1,
    models: options.plan.changes.map((change) => ({
      css: change.current.css,
      fields: change.current.fields,
      modelName: change.modelName,
      templates: change.current.templates,
    })),
    pluginVersion: options.pluginVersion,
  };

  await options.adapter.write(path, JSON.stringify(backup, null, 2));
  return path;
}
