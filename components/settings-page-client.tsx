"use client";

import { useState } from "react";
import {
  readJsonResponse,
  type PanelMessage,
} from "@/components/control-panel-client";
import type { StorageLoggingMode } from "@/lib/types";

type SettingsPageClientProps = {
  fullWebhookUrl: string;
  publicWebhookBaseUrl: string;
  recallApiKeyConfigured: boolean;
  recallRegion: string;
  sendChatEnabled: boolean;
  storageLoggingMode: StorageLoggingMode;
};

function formatBooleanLabel(value: boolean): string {
  return value ? "Yes" : "No";
}

export function SettingsPageClient(props: SettingsPageClientProps) {
  const [storageLoggingMode, setStorageLoggingMode] = useState<StorageLoggingMode>(
    props.storageLoggingMode,
  );
  const [savingMode, setSavingMode] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState<string | null>(null);
  const [message, setMessage] = useState<PanelMessage>(null);

  async function updateStorageMode(nextMode: StorageLoggingMode) {
    setSavingMode(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storageLoggingMode: nextMode,
        }),
      });
      const payload = await readJsonResponse<{
        error?: string;
        storageLoggingMode?: StorageLoggingMode;
      }>(response);

      if (!response.ok || !payload.storageLoggingMode) {
        throw new Error(payload.error ?? "Failed to update storage mode.");
      }

      setStorageLoggingMode(payload.storageLoggingMode);
      setMessage({
        type: "success",
        text: `Storage / Logging Mode updated to ${payload.storageLoggingMode}.`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to update storage mode.",
      });
    } finally {
      setSavingMode(false);
    }
  }

  async function runCleanupAction(config: {
    actionKey: string;
    confirmText: string;
    endpoint: string;
    successText: string;
  }) {
    const confirmed = window.confirm(config.confirmText);

    if (!confirmed) {
      return;
    }

    setRunningCleanup(config.actionKey);
    setMessage(null);

    try {
      const response = await fetch(config.endpoint, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{
        error?: string;
        removedCount?: number;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Cleanup action failed.");
      }

      const suffix =
        config.actionKey === "bot-history" &&
        typeof payload.removedCount === "number"
          ? ` Removed ${payload.removedCount} history bot record(s).`
          : "";

      setMessage({
        type: "success",
        text: `${config.successText}${suffix}`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "Cleanup action failed.",
      });
    } finally {
      setRunningCleanup(null);
    }
  }

  async function handleEmergencyStopAllBots() {
    const firstConfirmation = window.confirm(
      "Emergency Stop All Active Bots will attempt to remove every active bot across all sessions. Continue?",
    );

    if (!firstConfirmation) {
      return;
    }

    const secondConfirmation = window.confirm(
      "Final confirmation: stop all active bots across every session now?",
    );

    if (!secondConfirmation) {
      return;
    }

    setRunningCleanup("emergency-stop-all-bots");
    setMessage(null);

    try {
      const response = await fetch("/api/recall/bots/stop-all?allSessions=true", {
        method: "POST",
      });
      const payload = await readJsonResponse<{
        error?: string;
        totalActiveBots: number;
        stoppedCount: number;
        failedCount: number;
        failedBots: Array<{
          botId: string;
          error: string;
        }>;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to stop all active bots.");
      }

      const failureSummary =
        payload.failedBots.length > 0
          ? ` Failed: ${payload.failedBots
              .map((bot) => `${bot.botId} (${bot.error})`)
              .join(", ")}`
          : "";

      setMessage({
        type: payload.failedCount > 0 ? "error" : "success",
        text: `Emergency stop finished. Stopped ${payload.stoppedCount} of ${payload.totalActiveBots} active bot(s).${failureSummary}`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to stop all active bots.",
      });
    } finally {
      setRunningCleanup(null);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Settings</p>
          <h2>Environment preview and storage controls</h2>
          <p className="muted">
            These values are read on the server. The Recall API key is never
            shown in the browser.
          </p>
        </div>
      </section>

      {message ? <p className={`message ${message.type}`}>{message.text}</p> : null}

      <section className="card">
        <div className="card-header">
          <h3>Configuration</h3>
          <p>Restart the dev server after changing `.env.local`.</p>
        </div>
        <div className="card-body">
          <div className="settings-list">
            <div className="setting-item">
              <span className="setting-label">RECALL_REGION</span>
              <span className="setting-value">{props.recallRegion}</span>
            </div>
            <div className="setting-item">
              <span className="setting-label">RECALL_SEND_CHAT_ENABLED</span>
              <span className="setting-value">
                {props.sendChatEnabled ? "true" : "false"}
              </span>
            </div>
            <div className="setting-item">
              <span className="setting-label">PUBLIC_WEBHOOK_BASE_URL</span>
              <span className="setting-value">{props.publicWebhookBaseUrl}</span>
            </div>
            <div className="setting-item">
              <span className="setting-label">Full webhook URL</span>
              <span className="setting-value">{props.fullWebhookUrl}</span>
            </div>
            <div className="setting-item">
              <span className="setting-label">Recall API key configured</span>
              <span className="setting-value">
                {formatBooleanLabel(props.recallApiKeyConfigured)}
              </span>
            </div>
            <div className="setting-item">
              <span className="setting-label">Storage / Logging Mode</span>
              <span className="setting-value">{storageLoggingMode}</span>
            </div>
          </div>

          <div className="form" style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="storageLoggingMode">Storage / Logging Mode</label>
              <select
                id="storageLoggingMode"
                value={storageLoggingMode}
                disabled={savingMode}
                onChange={(event) =>
                  void updateStorageMode(
                    event.target.value as StorageLoggingMode,
                  )
                }
              >
                <option value="production_minimal">production_minimal</option>
                <option value="debug">debug</option>
              </select>
              <p className="muted">
                `production_minimal` is recommended for live use and smaller
                storage footprints. Turn on `debug` only when you need detailed
                webhook or transcript troubleshooting.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3>Cleanup Actions</h3>
          <p>These actions clear local history only. Recall keeps its own bot history.</p>
        </div>
        <div className="card-body">
          <div className="result-block">
            <h4>Safety Controls</h4>
            <p className="muted">
              Emergency stop is for safety only. It does not delete bot records or
              logs.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                disabled={runningCleanup !== null}
                onClick={() => void handleEmergencyStopAllBots()}
              >
                {runningCleanup === "emergency-stop-all-bots"
                  ? "Working..."
                  : "Emergency Stop All Active Bots"}
              </button>
            </div>
          </div>
          <div className="actions">
            <button
              className="button secondary"
              type="button"
              disabled={runningCleanup !== null}
              onClick={() =>
                void runCleanupAction({
                  actionKey: "bot-history",
                  confirmText:
                    "Clear all bot history records? Active bot records will be kept.",
                  endpoint: "/api/recall/bots/history",
                  successText: "Bot history cleared.",
                })
              }
            >
              {runningCleanup === "bot-history" ? "Working..." : "Clear Bot History"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={runningCleanup !== null}
              onClick={() =>
                void runCleanupAction({
                  actionKey: "transcript-logs",
                  confirmText: "Clear all transcript logs?",
                  endpoint: "/api/logs/transcript",
                  successText: "Transcript logs cleared.",
                })
              }
            >
              {runningCleanup === "transcript-logs"
                ? "Working..."
                : "Clear Transcript Logs"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={runningCleanup !== null}
              onClick={() =>
                void runCleanupAction({
                  actionKey: "webhook-debug-logs",
                  confirmText: "Clear all webhook debug logs?",
                  endpoint: "/api/logs/webhook-debug",
                  successText: "Webhook debug logs cleared.",
                })
              }
            >
              {runningCleanup === "webhook-debug-logs"
                ? "Working..."
                : "Clear Webhook Debug Logs"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={runningCleanup !== null}
              onClick={() =>
                void runCleanupAction({
                  actionKey: "matched-trigger-logs",
                  confirmText: "Clear all matched trigger logs?",
                  endpoint: "/api/logs/matched-trigger",
                  successText: "Matched trigger logs cleared.",
                })
              }
            >
              {runningCleanup === "matched-trigger-logs"
                ? "Working..."
                : "Clear Matched Trigger Logs"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={runningCleanup !== null}
              onClick={() =>
                void runCleanupAction({
                  actionKey: "timer-trigger-logs",
                  confirmText: "Clear all timer trigger logs?",
                  endpoint: "/api/logs/timer-trigger",
                  successText: "Timer trigger logs cleared.",
                })
              }
            >
              {runningCleanup === "timer-trigger-logs"
                ? "Working..."
                : "Clear Timer Trigger Logs"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
