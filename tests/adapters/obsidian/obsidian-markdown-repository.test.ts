import { describe, expect, it, vi } from "vitest";

import { ObsidianMarkdownRepository } from "../../../src/adapters/obsidian/obsidian-markdown-repository.js";

function createApp(activeFile: object | null = null) {
  const files = [
    { basename: "First", path: "First.md" },
    { basename: "Second", path: "Folder/Second.md" },
  ];
  const read = vi.fn(async (file: { path: string }) => `content:${file.path}`);
  const modify = vi.fn(async () => undefined);
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      modify,
      read,
    },
    workspace: { getActiveFile: () => activeFile },
  };

  return { app, files, modify, read };
}

describe("ObsidianMarkdownRepository", () => {
  it("reads every Markdown file into the application port shape", async () => {
    const { app, files } = createApp();
    const repository = new ObsidianMarkdownRepository(app as never);

    const notes = await repository.getAllMarkdownNotes();

    expect(notes).toEqual([
      {
        file: files[0],
        markdown: "content:First.md",
        name: "First",
        path: "First.md",
      },
      {
        file: files[1],
        markdown: "content:Folder/Second.md",
        name: "Second",
        path: "Folder/Second.md",
      },
    ]);
  });

  it("returns null when there is no active file", async () => {
    const { app, read } = createApp();
    const repository = new ObsidianMarkdownRepository(app as never);

    await expect(repository.getActiveNote()).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("saves through Vault.modify using the original file handle", async () => {
    const file = { basename: "Active", path: "Active.md" };
    const { app, modify } = createApp(file);
    const repository = new ObsidianMarkdownRepository(app as never);
    const note = await repository.getActiveNote();
    if (!note) throw new Error("Expected an active note fixture.");

    await repository.saveNote(note, "changed");

    expect(modify).toHaveBeenCalledWith(file, "changed");
  });
});
