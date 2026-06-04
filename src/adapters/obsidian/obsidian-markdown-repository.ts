import type { App, TFile } from "obsidian";
import type {
  MarkdownNote,
  MarkdownRepository,
} from "../../application/ports.js";

export type { MarkdownNote };

export class ObsidianMarkdownRepository implements MarkdownRepository {
  constructor(private readonly app: App) {}

  async getAllMarkdownNotes(): Promise<MarkdownNote[]> {
    const files = this.app.vault.getMarkdownFiles();
    return Promise.all(
      files.map(async (file) => ({
        file,
        markdown: await this.app.vault.read(file),
        name: file.basename,
        path: file.path,
      })),
    );
  }

  async getActiveNote(): Promise<MarkdownNote | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return null;
    }

    return {
      file,
      markdown: await this.app.vault.read(file),
      name: file.basename,
      path: file.path,
    };
  }

  async saveNote(note: MarkdownNote, markdown: string): Promise<void> {
    // `note.file` is typed `unknown` at the port boundary; it is always a
    // `TFile` produced by the read methods above.
    await this.app.vault.modify(note.file as TFile, markdown);
  }
}
