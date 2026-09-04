import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveNote: vi.fn(),
  getAllMarkdownNotes: vi.fn<
    () => Promise<
      Array<{ file: object; markdown: string; name: string; path: string }>
    >
  >(async () => []),
  notices: [] as Array<{ hide: ReturnType<typeof vi.fn>; message: string }>,
  ankiClientOptions: [] as unknown[],
  repairManagedSourceTemplates: vi.fn(async () => ({
    modelsUpdated: 0,
    templatesUpdated: 0,
  })),
  inspectManagedModelStyle: vi.fn(),
  applyManagedModelStyle: vi.fn(),
  writeAnkiStyleBackup: vi.fn(),
  confirmAnkiStyle: vi.fn(),
  syntaxMigrationModals: [] as Array<{ items: unknown[] }>,
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
  AnkiConnectClient: class {
    constructor(options: unknown) {
      mocks.ankiClientOptions.push(options);
    }
  },
}));
vi.mock("../../../src/adapters/anki/upload-media.js", () => ({
  uploadMedia: vi.fn(),
}));
vi.mock("../../../src/adapters/anki/repair-managed-source-templates.js", () => ({
  repairManagedSourceTemplates: mocks.repairManagedSourceTemplates,
}));
vi.mock("../../../src/adapters/anki/manage-managed-model-style.js", () => ({
  applyManagedModelStyle: mocks.applyManagedModelStyle,
  inspectManagedModelStyle: mocks.inspectManagedModelStyle,
}));
vi.mock("../../../src/adapters/obsidian/anki-style-backup.js", () => ({
  writeAnkiStyleBackup: mocks.writeAnkiStyleBackup,
}));
vi.mock("../../../src/adapters/obsidian/anki-style-confirm-modal.js", () => ({
  createAnkiStyleConfirmer: vi.fn(() => mocks.confirmAnkiStyle),
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
vi.mock("../../../src/adapters/obsidian/syntax-migration-modal.js", () => ({
  SyntaxMigrationModal: class {
    constructor(_app: unknown, options: { items: unknown[] }) {
      mocks.syntaxMigrationModals.push(options);
    }
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
      vault: {
        adapter: {},
        configDir: ".obsidian",
        getName: () => "Vault",
      },
      secretStorage: {
        getSecret: vi.fn((id: string) =>
          id === "flashcards-anki-key" ? "secret-value" : null,
        ),
      },
      workspace: { getActiveFile: () => ({ extension: "md", path: "Note.md" }) },
    },
    logger,
    manifest: {
      dir: ".obsidian/plugins/flashcards-obsidian",
      id: "flashcards-obsidian",
      version: "2.0.0",
    },
    refreshStatusBars,
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      ankiConnectApiKeySecret: "flashcards-anki-key",
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
  const syntaxCheck = commands.find(
    (command) => command.id === "flashcards-check-v2-syntax",
  );
  if (!syntaxCheck?.callback) throw new Error("Syntax-check command missing.");
  const ankiStyle = commands.find(
    (command) => command.id === "flashcards-apply-v2-anki-style",
  );
  if (!ankiStyle?.callback) throw new Error("Anki-style command missing.");
  return {
    ankiStyle,
    commands,
    current,
    host,
    logger,
    refreshStatusBars,
    syntaxCheck,
  };
}

describe("Obsidian sync commands", () => {
  beforeEach(() => {
    mocks.getActiveNote.mockReset();
    mocks.getAllMarkdownNotes.mockReset();
    mocks.getAllMarkdownNotes.mockResolvedValue([]);
    mocks.notices.length = 0;
    mocks.repairManagedSourceTemplates.mockClear();
    mocks.repairManagedSourceTemplates.mockResolvedValue({
      modelsUpdated: 0,
      templatesUpdated: 0,
    });
    mocks.ankiClientOptions.length = 0;
    mocks.syntaxMigrationModals.length = 0;
    mocks.syncNote.mockReset();
    mocks.inspectManagedModelStyle.mockReset();
    mocks.inspectManagedModelStyle.mockResolvedValue({
      blocked: [],
      changes: [],
    });
    mocks.applyManagedModelStyle.mockReset();
    mocks.applyManagedModelStyle.mockResolvedValue(undefined);
    mocks.writeAnkiStyleBackup.mockReset();
    mocks.writeAnkiStyleBackup.mockResolvedValue("backup.json");
    mocks.confirmAnkiStyle.mockReset();
    mocks.confirmAnkiStyle.mockResolvedValue(false);
  });

  it("names update commands after their one-way Anki destination", () => {
    const { commands } = createHost();

    expect(
      commands.find(
        (command) => command.id === "flashcards-sync-current-note",
      )?.name,
    ).toBe("Update Anki from current note");
    expect(
      commands.find((command) => command.id === "flashcards-sync-vault")?.name,
    ).toBe("Update Anki from vault");
  });

  it("passes the selected Obsidian secret to AnkiConnect", async () => {
    mocks.getActiveNote.mockResolvedValue(null);
    const { current, host } = createHost();

    current.checkCallback?.(false);

    await vi.waitFor(() => expect(mocks.ankiClientOptions).toHaveLength(1));
    expect(host.app.secretStorage.getSecret).toHaveBeenCalledWith(
      "flashcards-anki-key",
    );
    expect(mocks.ankiClientOptions[0]).toEqual({ apiKey: "secret-value" });
  });

  it("repairs managed Context and Source templates before syncing the current note", async () => {
    mocks.getActiveNote.mockResolvedValue(null);
    const { current } = createHost();

    current.checkCallback?.(false);

    await vi.waitFor(() =>
      expect(mocks.repairManagedSourceTemplates).toHaveBeenCalledOnce(),
    );
  });

  it("shows exact locations for read-only syntax migration results", async () => {
    mocks.getAllMarkdownNotes.mockResolvedValue([
      {
        file: {},
        markdown: "Question #card\n\nAnswer\n\n^",
        name: "Legacy",
        path: "Folder/Legacy.md",
      },
    ]);
    const { syntaxCheck } = createHost();

    syntaxCheck.callback?.();

    await vi.waitFor(() => expect(mocks.syntaxMigrationModals).toHaveLength(1));
    expect(mocks.syntaxMigrationModals[0]?.items).toEqual([
      expect.objectContaining({
        line: 5,
        notePath: "Folder/Legacy.md",
        replacement: expect.stringContaining("tagged heading"),
      }),
    ]);
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

  it("does nothing when the Anki style preview is cancelled", async () => {
    mocks.inspectManagedModelStyle.mockResolvedValue(stylePlan());
    const { ankiStyle } = createHost();

    ankiStyle.callback?.();

    await vi.waitFor(() => expect(mocks.confirmAnkiStyle).toHaveBeenCalled());
    expect(mocks.writeAnkiStyleBackup).not.toHaveBeenCalled();
    expect(mocks.applyManagedModelStyle).not.toHaveBeenCalled();
  });

  it("backs up models before applying the v2 Anki style", async () => {
    const order: string[] = [];
    const plan = stylePlan();
    mocks.inspectManagedModelStyle.mockResolvedValue(plan);
    mocks.confirmAnkiStyle.mockResolvedValue(true);
    mocks.writeAnkiStyleBackup.mockImplementation(async () => {
      order.push("backup");
      return "backups/anki-style.json";
    });
    mocks.applyManagedModelStyle.mockImplementation(async () => {
      order.push("apply");
    });
    const { ankiStyle, host, refreshStatusBars } = createHost();

    ankiStyle.callback?.();

    await vi.waitFor(() => expect(mocks.applyManagedModelStyle).toHaveBeenCalled());
    expect(order).toEqual(["backup", "apply"]);
    expect(host.syncInFlight).toBe(false);
    expect(refreshStatusBars).toHaveBeenCalledOnce();
    expect(mocks.notices.at(-1)?.message).toContain(
      "Applied v2 style to 1 Anki model",
    );
  });

  it("does not change Anki when the style backup fails", async () => {
    mocks.inspectManagedModelStyle.mockResolvedValue(stylePlan());
    mocks.confirmAnkiStyle.mockResolvedValue(true);
    mocks.writeAnkiStyleBackup.mockRejectedValue(new Error("disk full"));
    const { ankiStyle } = createHost();

    ankiStyle.callback?.();

    await vi.waitFor(() =>
      expect(mocks.notices.at(-1)?.message).toContain("disk full"),
    );
    expect(mocks.applyManagedModelStyle).not.toHaveBeenCalled();
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

function stylePlan() {
  return {
    blocked: [],
    changes: [
      {
        current: {
          css: "old",
          fields: ["Front", "Back", "Context", "Source"],
          templates: { "Card 1": { Back: "old", Front: "old" } },
        },
        desired: {
          css: "new",
          templates: { "Card 1": { Back: "new", Front: "new" } },
        },
        missingContext: false,
        missingSource: false,
        modelName: "Obsidian-basic",
      },
    ],
  };
}
