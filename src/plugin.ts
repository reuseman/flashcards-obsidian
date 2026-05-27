import { Notice, Plugin, TFile, debounce } from "obsidian";

import { registerPluginCommands } from "./adapters/obsidian/commands.js";
import { ObsidianFileLogger } from "./adapters/obsidian/file-logger.js";
import { ObsidianMarkdownRepository } from "./adapters/obsidian/obsidian-markdown-repository.js";
import { FlashcardsSettingTab } from "./adapters/obsidian/settings-tab.js";
import {
  computeActiveNoteStatus,
  computePendingV1Count,
  renderActiveNoteStatus,
  renderPendingV1,
} from "./adapters/obsidian/status-bar.js";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type FlashcardsSettings,
} from "./core/config/settings.js";
import {
  CompositeLogger,
  ConsoleLogger,
  NoopLogger,
  type Logger,
} from "./core/logging/logger.js";

export default class FlashcardsPlugin extends Plugin {
  settings: FlashcardsSettings = DEFAULT_SETTINGS;
  logger: Logger = new NoopLogger();
  syncInFlight = false;

  private fileLogger: ObsidianFileLogger | undefined;
  private activeNoteStatusEl: HTMLElement | undefined;
  private pendingV1StatusEl: HTMLElement | undefined;

  override async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.rebuildLogger();

    this.activeNoteStatusEl = this.addStatusBarItem();
    this.pendingV1StatusEl = this.addStatusBarItem();
    renderActiveNoteStatus(this.activeNoteStatusEl, null);
    renderPendingV1(this.pendingV1StatusEl, 0);

    this.addSettingTab(new FlashcardsSettingTab(this.app, this));
    registerPluginCommands(this);

    this.registerWorkspaceEvents();

    // Initial paint — defer to next tick so workspace is ready.
    this.app.workspace.onLayoutReady(() => {
      void this.refreshActiveNoteStatus();
      void this.refreshPendingV1Status();
    });

    this.logger.info("plugin loaded", { version: this.manifest.version });
    new Notice("Flashcards v2 scaffold loaded.");
  }

  override async onunload(): Promise<void> {
    this.logger.info("plugin unloading");
    await this.fileLogger?.flush();
    await this.saveData(this.settings);
  }

  async updateSettings(next: Partial<FlashcardsSettings>): Promise<void> {
    const prev = this.settings;
    this.settings = { ...this.settings, ...next };
    await this.saveData(this.settings);
    if (
      prev.logLevel !== this.settings.logLevel ||
      prev.logToFile !== this.settings.logToFile
    ) {
      this.rebuildLogger();
    }
    if (
      prev.v1MigrationDecisionMade !== this.settings.v1MigrationDecisionMade
    ) {
      void this.refreshPendingV1Status();
    }
  }

  /** Called by commands after a sync completes. */
  refreshStatusBars(): void {
    void this.refreshActiveNoteStatus();
    void this.refreshPendingV1Status();
  }

  private rebuildLogger(): void {
    const sinks: Logger[] = [new ConsoleLogger(this.settings.logLevel)];
    if (this.settings.logToFile) {
      const path = `${this.manifest.dir ?? this.app.vault.configDir + "/plugins/" + this.manifest.id}/sync.log`;
      this.fileLogger = new ObsidianFileLogger(
        this.app.vault.adapter,
        path,
        this.settings.logLevel,
      );
      sinks.push(this.fileLogger);
    } else {
      this.fileLogger = undefined;
    }
    this.logger = sinks.length === 1 ? sinks[0]! : new CompositeLogger(sinks);
  }

  private registerWorkspaceEvents(): void {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.refreshActiveNoteStatus();
      }),
    );
    // Debounce vault-wide recompute so heavy editing doesn't thrash.
    const debouncedV1 = debounce(
      () => {
        void this.refreshPendingV1Status();
      },
      1500,
      true,
    );
    const debouncedActive = debounce(
      () => {
        void this.refreshActiveNoteStatus();
      },
      400,
      true,
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const active = this.app.workspace.getActiveFile();
        if (active && active.path === file.path) debouncedActive();
        debouncedV1();
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") debouncedV1();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") debouncedV1();
      }),
    );
  }

  private async refreshActiveNoteStatus(): Promise<void> {
    if (!this.activeNoteStatusEl) return;
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      renderActiveNoteStatus(this.activeNoteStatusEl, null);
      return;
    }
    try {
      const markdown = await this.app.vault.read(file);
      const text = computeActiveNoteStatus(markdown, file.path, this.settings);
      renderActiveNoteStatus(this.activeNoteStatusEl, text);
    } catch (e) {
      this.logger.warn("refreshActiveNoteStatus failed", {
        path: file.path,
        error: e instanceof Error ? e.message : String(e),
      });
      renderActiveNoteStatus(this.activeNoteStatusEl, null);
    }
  }

  private async refreshPendingV1Status(): Promise<void> {
    if (!this.pendingV1StatusEl) return;
    // Hide once the user has decided — don't keep nagging.
    if (this.settings.v1MigrationDecisionMade) {
      renderPendingV1(this.pendingV1StatusEl, 0);
      return;
    }
    try {
      const repository = new ObsidianMarkdownRepository(this.app);
      const count = await computePendingV1Count(repository);
      renderPendingV1(this.pendingV1StatusEl, count);
    } catch (e) {
      this.logger.warn("refreshPendingV1Status failed", {
        error: e instanceof Error ? e.message : String(e),
      });
      renderPendingV1(this.pendingV1StatusEl, 0);
    }
  }
}
