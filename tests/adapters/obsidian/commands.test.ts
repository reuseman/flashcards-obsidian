import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveNote: vi.fn(),
  getAllMarkdownNotes: vi.fn(async () => []),
  notices: [] as Array<{ hide: ReturnType<typeof vi.fn>; message: string }>,
  syncNote: vi.fn(),
}));

vi.mock("obsidian", () => ({
  Notice: class {
    hide = vi.fn();
    message: string;

    constructor(message: string) {
      this.message = message;
      mocks.notices.push(this);
    }
  },
}));

vi.mock("../../../src/adapters/anki/anki-connect-client.js", () => ({
  AnkiConnectClient: class {},
}));
vi.mock("../../../src/adapters/anki/upload-media.js", () => ({
  uploadMedia: vi.fn(),
}));
vi.mock("../../../src/adapters/obsidian/obsidian-markdown-repository.js", () => ({
  ObsidianMarkdownRepository: class {
    getActiveNote = mocks.getActiveNote;
    getAllMarkdownNotes = mocks.getAllMarkdownNotes;
  },
}));
vi.mock("../../../src/adapters/obsidian/media-resolver.js", () => ({
  buildMediaRewriteMap: vi.fn(() => new Map()),
  resolveMedia: vi.fn(async () => ({ errors: [], resolved: new Map() })),
}));
vi.mock("../../../src/adapters/obsidian/wikilink-resolver.js", () => ({
  createWikilinkResolver: vi.fn(),
}));
vi.mock("../../../src/adapters/obsidian/delete-confirm-modal.js", () => ({
  createDeleteConfirmer: vi.fn(),
}));
vi.mock("../../../src/adapters/obsidian/kind-recreation-confirm-modal.js", () => ({
  createKindRecreationConfirmer: vi.fn(() => vi.fn()),
}));
vi.mock("../../../src/adapters/obsidian/migration-modal.js", () => ({
  MigrationModal: class {
    open = vi.fn();
  },
}));
vi.mock("../../../src/application/sync-note.js", () => ({
  syncNote: mocks.syncNote,
}));

import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import type { PluginHost } from "../../../src/adapters/obsidian/plugin-host.js";
import { registerPluginCommands } from "../../../src/adapters/obsidian/commands.js";

interface RegisteredCommand {
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean;
  id: string;
  name: string;
}

function createHost() {
  const commands: RegisteredCommand[] = [];
  const refreshStatusBars = vi.fn();
  const logger = { error: vi.fn() };
  const host = {
    addCommand(command: RegisteredCommand) {
      commands.push(command);
      return command;
    },
    addStatusBarItem: vi.fn(),
    app: {
      metadataCache: {},
      vault: { getName: () => "Vault" },
      workspace: { getActiveFile: () => ({ extension: "md", path: "Note.md" }) },
    },
    logger,
    refreshStatusBars,
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      v1MigrationDecisionMade: true,
    },
    syncInFlight: false,
    updateSettings: vi.fn(),
  } as unknown as PluginHost;

  registerPluginCommands(host);
  const current = commands.find(
    (command) => command.id === "flashcards-sync-current-note",
  );
  if (!current?.checkCallback) throw new Error("Current-note command missing.");
  return { current, host, logger, refreshStatusBars };
}

describe("Obsidian sync commands", () => {
  beforeEach(() => {
    mocks.getActiveNote.mockReset();
    mocks.notices.length = 0;
    mocks.syncNote.mockReset();
  });

  it("does not start another sync while one is running", () => {
    const { current, host } = createHost();
    host.syncInFlight = true;

    expect(current.checkCallback?.(false)).toBe(true);

    expect(mocks.syncNote).not.toHaveBeenCalled();
    expect(mocks.notices.map((notice) => notice.message)).toEqual([
      "Sync already in progress.",
    ]);
  });

  it("keeps the lock until current-note sync finishes", async () => {
    type SyncResult = {
      ankiResults: { creates: never[]; deletes: never[]; updates: never[] };
      notePath: string;
      status: "ok";
    };
    let resolvePending: (result: SyncResult) => void = () => undefined;
    const pending = new Promise<SyncResult>((resolve) => {
      resolvePending = resolve;
    });
    mocks.getActiveNote.mockResolvedValue({
      file: {},
      markdown: "Question:: Answer",
      name: "Note",
      path: "Note.md",
    });
    mocks.syncNote.mockReturnValue(pending);
    const { current, host, refreshStatusBars } = createHost();

    current.checkCallback?.(false);
    await vi.waitFor(() => expect(mocks.syncNote).toHaveBeenCalledOnce());
    expect(host.syncInFlight).toBe(true);

    resolvePending({
      ankiResults: { creates: [], deletes: [], updates: [] },
      notePath: "Note.md",
      status: "ok",
    });
    await vi.waitFor(() => expect(host.syncInFlight).toBe(false));
    expect(refreshStatusBars).toHaveBeenCalledOnce();
    expect(mocks.notices.map((notice) => notice.message)).toContain(
      "Synced Note.md: +0 ~0 -0",
    );
  });

  it("hides the progress notice and reports a sync failure", async () => {
    mocks.getActiveNote.mockResolvedValue({
      file: {},
      markdown: "Question:: Answer",
      name: "Note",
      path: "Note.md",
    });
    mocks.syncNote.mockRejectedValue(new Error("Anki is offline"));
    const { current, logger } = createHost();

    current.checkCallback?.(false);
    await vi.waitFor(() =>
      expect(mocks.notices.map((notice) => notice.message)).toContain(
        "Sync failed: Anki is offline",
      ),
    );

    expect(mocks.notices[0]?.hide).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith("dispatch failed", {
      error: "Anki is offline",
      target: "current",
    });
  });
});
