import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ankiVersion: vi.fn(async () => 6),
  detectAnkiCommand: vi.fn((): string | null => null),
  launchAnkiCommand: vi.fn(async (_command: string) => {}),
}));

vi.mock("obsidian", () => ({
  Notice: class {
    hide = vi.fn();
    containerEl = { addEventListener: vi.fn() };
    constructor(public message: string) {}
  },
}));
// Obsidian plugin code runs in a browser realm and uses `window` timers; the
// bare node test env has no `window`, so stub the one member that is used.
// Delegates lazily rather than capturing `globalThis.setTimeout` up front, so
// `vi.useFakeTimers()` inside a test still takes effect.
vi.stubGlobal("window", {
  setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
});

vi.mock("../../../src/adapters/anki/anki-connect-client.js", () => ({
  AnkiConnectClient: class {
    version = mocks.ankiVersion;
  },
}));
vi.mock("../../../src/adapters/obsidian/anki-launcher.js", () => ({
  detectAnkiCommand: mocks.detectAnkiCommand,
  launchAnkiCommand: mocks.launchAnkiCommand,
}));

import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import {
  resolveConfiguredLaunchCommand,
  testAnkiConnection,
} from "../../../src/adapters/obsidian/anki-availability.js";
import type { PluginHost } from "../../../src/adapters/obsidian/plugin-host.js";

function createHost(): PluginHost {
  return {
    app: { secretStorage: { getSecret: vi.fn(() => null) } },
    logger: { error: vi.fn(), warn: vi.fn() },
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      ankiLaunch: { enabled: true, command: "", waitSeconds: 1 },
    },
  } as unknown as PluginHost;
}

describe("resolveConfiguredLaunchCommand", () => {
  beforeEach(() => {
    mocks.detectAnkiCommand.mockReset();
    mocks.detectAnkiCommand.mockReturnValue("anki");
  });

  it("is empty when auto-launch is off, without probing the machine", () => {
    const host = createHost();
    host.settings.ankiLaunch.enabled = false;

    expect(resolveConfiguredLaunchCommand(host)).toBe("");
    expect(mocks.detectAnkiCommand).not.toHaveBeenCalled();
  });

  it("falls back to detection only when no command is configured", () => {
    const host = createHost();
    expect(resolveConfiguredLaunchCommand(host)).toBe("anki");

    host.settings.ankiLaunch.command = " /opt/anki/anki ";
    expect(resolveConfiguredLaunchCommand(host)).toBe("/opt/anki/anki");
  });

  it("is empty when nothing is configured and nothing is detected", () => {
    mocks.detectAnkiCommand.mockReturnValue(null);
    expect(resolveConfiguredLaunchCommand(createHost())).toBe("");
  });
});

describe("testAnkiConnection", () => {
  beforeEach(() => {
    mocks.ankiVersion.mockReset();
    mocks.ankiVersion.mockResolvedValue(6);
    mocks.detectAnkiCommand.mockReset();
    mocks.detectAnkiCommand.mockReturnValue(null);
    mocks.launchAnkiCommand.mockReset();
    mocks.launchAnkiCommand.mockResolvedValue(undefined);
  });

  it("reports the AnkiConnect version when Anki is already up", async () => {
    await expect(testAnkiConnection(createHost())).resolves.toBe(
      "Anki is running (AnkiConnect v6).",
    );
    expect(mocks.launchAnkiCommand).not.toHaveBeenCalled();
  });

  it("says what to fix when no launch command could be resolved", async () => {
    mocks.ankiVersion.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(testAnkiConnection(createHost())).resolves.toBe(
      "Anki is not running and no Anki install was detected — set a launch command.",
    );
  });

  it("points at the toggle when auto-launch is off", async () => {
    mocks.ankiVersion.mockRejectedValue(new Error("ECONNREFUSED"));
    const host = createHost();
    host.settings.ankiLaunch.enabled = false;

    await expect(testAnkiConnection(host)).resolves.toBe(
      "Anki is not running and starting Anki automatically is off.",
    );
  });

  it("confirms a launch command that brings AnkiConnect up", async () => {
    vi.useFakeTimers();
    try {
      mocks.detectAnkiCommand.mockReturnValue("anki");
      mocks.ankiVersion
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValue(6);

      const promise = testAnkiConnection(createHost());
      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe(
        "Started Anki with `anki` and AnkiConnect responded.",
      );
      expect(mocks.launchAnkiCommand).toHaveBeenCalledWith("anki");
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a spawn failure verbatim so a wrong path is obvious", async () => {
    vi.useFakeTimers();
    try {
      mocks.ankiVersion.mockRejectedValue(new Error("ECONNREFUSED"));
      mocks.launchAnkiCommand.mockRejectedValue(new Error("spawn ENOENT"));
      const host = createHost();
      host.settings.ankiLaunch.command = "/wrong/anki";

      const promise = testAnkiConnection(host);
      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe(
        "Could not start Anki with `/wrong/anki`: spawn ENOENT",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("blames AnkiConnect when the process starts but nothing answers", async () => {
    vi.useFakeTimers();
    try {
      mocks.detectAnkiCommand.mockReturnValue("anki");
      mocks.ankiVersion.mockRejectedValue(new Error("ECONNREFUSED"));

      const promise = testAnkiConnection(createHost());
      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toContain(
        "AnkiConnect add-on is installed",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
