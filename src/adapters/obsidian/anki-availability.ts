import { Notice } from "obsidian";

import { AnkiConnectClient } from "../anki/anki-connect-client.js";
import {
  ensureAnkiRunning,
  type AnkiWaitHandle,
} from "../anki/ensure-anki-running.js";
import { detectAnkiCommand, launchAnkiCommand } from "./anki-launcher.js";
import { obsidianAnkiConnectTransport } from "./anki-connect-transport.js";
import type { PluginHost } from "./plugin-host.js";

export function createAnkiClient(plugin: PluginHost): AnkiConnectClient {
  const secretName = plugin.settings.ankiConnectApiKeySecret;
  const apiKey = secretName
    ? (plugin.app.secretStorage.getSecret(secretName) ?? undefined)
    : undefined;
  return new AnkiConnectClient({
    ...(apiKey ? { apiKey } : {}),
    transport: obsidianAnkiConnectTransport,
  });
}

/**
 * The command that would be used to start Anki: the user's own if set,
 * otherwise a detected install. Empty when auto-launch is off or Anki was not
 * found in any known location.
 */
export function resolveConfiguredLaunchCommand(plugin: PluginHost): string {
  const { command, enabled } = plugin.settings.ankiLaunch;
  if (!enabled) return "";
  return command.trim() || (detectAnkiCommand() ?? "");
}

/**
 * Persistent notice that doubles as the cancel affordance: Obsidian dismisses
 * a notice on click, so the same click is what stops the wait.
 */
function notifyWaiting(message: string): AnkiWaitHandle {
  const notice = new Notice(message, 0);
  let cancelled = false;
  // `containerEl`, not `messageEl`: the whole notice is the cancel target, so a
  // click on its padding counts too (this is what the deprecated `noticeEl`
  // used to be).
  notice.containerEl.addEventListener("click", () => {
    cancelled = true;
  });
  return {
    cancelled: () => cancelled,
    hide: () => {
      notice.hide();
    },
  };
}

function waitForAnki(
  plugin: PluginHost,
  ankiClient: AnkiConnectClient,
  launchCommand: string,
) {
  return ensureAnkiRunning({
    ...(launchCommand
      ? { launch: () => launchAnkiCommand(launchCommand) }
      : {}),
    notify: notifyWaiting,
    probe: async () => {
      await ankiClient.version();
      return true;
    },
    sleep: (ms) =>
      new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      }),
    timeoutMs: plugin.settings.ankiLaunch.waitSeconds * 1000,
  });
}

/**
 * Blocks a command until AnkiConnect answers, starting Anki first when the
 * user has that enabled. Runs before any planning or writeback, so giving up
 * costs the user nothing.
 */
export async function ensureAnkiAvailable(
  plugin: PluginHost,
  ankiClient: AnkiConnectClient,
): Promise<boolean> {
  const { waitSeconds } = plugin.settings.ankiLaunch;
  const launchCommand = resolveConfiguredLaunchCommand(plugin);
  const result = await waitForAnki(plugin, ankiClient, launchCommand);

  if (result.status === "ready") return true;

  if (result.status === "cancelled") {
    new Notice("Sync cancelled — Anki is not running.");
    return false;
  }

  const launchSuffix = result.launchError
    ? ` Could not start Anki: ${result.launchError}.`
    : "";
  plugin.logger.warn("Anki unavailable", {
    launchCommand,
    ...(result.launchError ? { launchError: result.launchError } : {}),
    waitSeconds,
  });
  new Notice(
    `Anki did not respond within ${waitSeconds}s.${launchSuffix} Start Anki and confirm the AnkiConnect add-on is installed, then try again.`,
  );
  return false;
}

/**
 * Settings-tab probe. Same path as a real sync, but reports the outcome as a
 * sentence instead of a boolean so a wrong launch command is diagnosable
 * without running a sync.
 */
export async function testAnkiConnection(plugin: PluginHost): Promise<string> {
  const ankiClient = createAnkiClient(plugin);
  try {
    const version = await ankiClient.version();
    return `Anki is running (AnkiConnect v${version}).`;
  } catch {
    // Not up yet — fall through to the launch-and-wait path.
  }

  const launchCommand = resolveConfiguredLaunchCommand(plugin);
  if (!launchCommand) {
    const reason = plugin.settings.ankiLaunch.enabled
      ? "no Anki install was detected — set a launch command"
      : "starting Anki automatically is off";
    return `Anki is not running and ${reason}.`;
  }

  const result = await waitForAnki(plugin, ankiClient, launchCommand);
  if (result.status === "ready") {
    return `Started Anki with \`${launchCommand}\` and AnkiConnect responded.`;
  }
  if (result.status === "cancelled") {
    return "Test cancelled.";
  }
  return result.launchError
    ? `Could not start Anki with \`${launchCommand}\`: ${result.launchError}`
    : `Started \`${launchCommand}\` but AnkiConnect did not respond within ${plugin.settings.ankiLaunch.waitSeconds}s. Check that the AnkiConnect add-on is installed.`;
}
