import type { App, TFile } from "obsidian";

export interface MarkdownNote {
  markdown: string;
  name: string;
  path: string;
  file: TFile;
}

export class ObsidianMarkdownRepository {
  constructor(private readonly app: App) {}

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
    await this.app.vault.modify(note.file, markdown);
  }
}
