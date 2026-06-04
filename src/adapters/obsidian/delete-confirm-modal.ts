import { Modal, Setting, type App } from "obsidian";

import type { AnkiConnectClient } from "../anki/anki-connect-client.js";
import type { PendingDeletion } from "../../core/sync/sync-plan.js";

interface NoteInfo {
  noteId: number;
  fields: Record<string, { value: string; order: number }>;
}

/**
 * Adapter-side confirmer for delete-safety (spec §4.5). The core hands us
 * `PendingDeletion[]` (which carry no front text — the card is already gone from
 * the note). We enrich each row with the card's live Anki front via
 * `notesInfo`, since the note still exists until the user confirms here.
 */
export function createDeleteConfirmer(
  app: App,
  ankiClient: AnkiConnectClient,
): (pending: PendingDeletion[]) => Promise<boolean> {
  return (pending) =>
    new Promise<boolean>((resolve) => {
      void (async () => {
        let fronts: Map<number, string>;
        try {
          fronts = await fetchFronts(ankiClient, pending);
        } catch {
          fronts = new Map();
        }
        new DeleteConfirmModal(app, pending, fronts, resolve).open();
      })();
    });
}

async function fetchFronts(
  ankiClient: AnkiConnectClient,
  pending: PendingDeletion[],
): Promise<Map<number, string>> {
  const nids = pending.map((p) => p.nid);
  const infos = await ankiClient.invoke<NoteInfo[]>({
    action: "notesInfo",
    params: { notes: nids },
  });
  const out = new Map<number, string>();
  for (const info of infos) {
    if (!info || typeof info.noteId !== "number") continue;
    const front = info.fields?.Front?.value ?? info.fields?.Text?.value ?? "";
    out.set(info.noteId, front);
  }
  return out;
}

class DeleteConfirmModal extends Modal {
  private readonly pending: PendingDeletion[];
  private readonly fronts: Map<number, string>;
  private readonly resolve: (confirmed: boolean) => void;
  private resolved = false;

  constructor(
    app: App,
    pending: PendingDeletion[],
    fronts: Map<number, string>,
    resolve: (confirmed: boolean) => void,
  ) {
    super(app);
    this.pending = pending;
    this.fronts = fronts;
    this.resolve = resolve;
  }

  override onOpen(): void {
    const count = this.pending.length;
    const cardWord = count === 1 ? "card" : "cards";
    this.setTitle(`Delete ${count} Anki ${cardWord}?`);

    this.contentEl.createEl("p", {
      text:
        `${count} ${cardWord} no longer appear in this note and will be ` +
        `permanently deleted from Anki, including their review history.`,
    });

    const list = this.contentEl.createEl("ul");
    for (const p of this.pending) {
      const front = this.fronts.get(p.nid);
      const label = front && front.trim().length > 0 ? stripHtml(front) : p.blockId;
      list.createEl("li", { text: `${label} — ${p.deckName}` });
    }

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Delete")
          .setWarning()
          .onClick(() => {
            this.finish(true);
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Keep them")
          .setCta()
          .onClick(() => {
            this.finish(false);
          }),
      );
  }

  override onClose(): void {
    // Closing via Esc / outside-click counts as cancel — never silently delete.
    this.finish(false);
  }

  private finish(confirmed: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(confirmed);
    this.close();
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}
