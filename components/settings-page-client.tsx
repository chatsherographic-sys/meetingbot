"use client";

import { useMeetingSession } from "@/components/meeting-session-context";
import {
  formatTime,
  readJsonResponse,
  type PanelMessage,
} from "@/components/control-panel-client";
import type { StorageDriver } from "@/lib/storage/types";
import { getSessionOperationBlockedMessage } from "@/lib/session-operations";
import { useState } from "react";

type SettingsPageClientProps = {
  recallApiKeyConfigured: boolean;
  recallRegion: string;
  sendChatEnabled: boolean;
  storageDriver: StorageDriver;
  storageOk: boolean;
  storageCheckedAt: string;
  storageError: string | null;
};

function formatBooleanLabel(value: boolean): string {
  return value ? "Yes" : "No";
}

export function SettingsPageClient(props: SettingsPageClientProps) {
  const { currentSession } = useMeetingSession();
  const [runningCleanup, setRunningCleanup] = useState<string | null>(null);
  const [message, setMessage] = useState<PanelMessage>(null);
  const currentSessionBlockedMessage = getSessionOperationBlockedMessage(
    currentSession?.status,
  );
  const supabaseConnectedLabel =
    props.storageDriver === "supabase"
      ? props.storageOk
        ? "Connected"
        : "Connection failed"
      : "Local mode";

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
          <h2>Live chat environment and safety controls</h2>
          <p className="muted">
            This page shows only the settings that matter for the simplified
            live-chat workflow.
          </p>
        </div>
      </section>

      {message ? <p className={`message ${message.type}`}>{message.text}</p> : null}

      <div className="page-grid">
        <section className="card">
          <div className="card-header">
            <h3>Recall Chat Status</h3>
            <p>Server-side configuration used for bot chat sending.</p>
          </div>
          <div className="card-body">
            <div className="settings-list">
              <div className="setting-item">
                <span className="setting-label">Recall Region</span>
                <span className="setting-value">{props.recallRegion}</span>
              </div>
              <div className="setting-item">
                <span className="setting-label">Send Chat Mode</span>
                <span className="setting-value">
                  {props.sendChatEnabled ? "Real send enabled" : "Dry-run mode"}
                </span>
              </div>
              <div className="setting-item">
                <span className="setting-label">Recall API key configured</span>
                <span className="setting-value">
                  {formatBooleanLabel(props.recallApiKeyConfigured)}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Storage Status</h3>
            <p>Supabase connectivity is checked server-side.</p>
          </div>
          <div className="card-body">
            <div className="settings-list">
              <div className="setting-item">
                <span className="setting-label">Storage Driver</span>
                <span className="setting-value">{props.storageDriver}</span>
              </div>
              <div className="setting-item">
                <span className="setting-label">Supabase Connected</span>
                <span className="setting-value">{supabaseConnectedLabel}</span>
              </div>
              <div className="setting-item">
                <span className="setting-label">Last Checked</span>
                <span className="setting-value">
                  {formatTime(props.storageCheckedAt)}
                </span>
              </div>
            </div>
            {props.storageError ? (
              <p className="message error" style={{ marginTop: 16 }}>
                {props.storageError}
              </p>
            ) : null}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Current Session</h3>
            <p>The sidebar session selector controls bots, schedules, and live chat.</p>
          </div>
          <div className="card-body">
            <div className="settings-list">
              <div className="setting-item">
                <span className="setting-label">Session Name</span>
                <span className="setting-value">
                  {currentSession?.name ?? "(not selected)"}
                </span>
              </div>
              <div className="setting-item">
                <span className="setting-label">Session Status</span>
                <span className="setting-value">
                  {currentSession?.status ?? "(unknown)"}
                </span>
              </div>
              <div className="setting-item">
                <span className="setting-label">Zoom URL</span>
                <span className="setting-value">
                  {currentSession?.zoomUrl?.trim() || "(not set)"}
                </span>
              </div>
            </div>
            {currentSessionBlockedMessage ? (
              <p className="message warning" style={{ marginTop: 16 }}>
                {currentSessionBlockedMessage}
              </p>
            ) : null}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Safety Controls</h3>
            <p>These actions help clean up bot records or stop live bots quickly.</p>
          </div>
          <div className="card-body">
            <div className="result-block">
              <h4>Emergency Stop</h4>
              <p className="muted">
                Emergency stop attempts to remove every active bot across all
                sessions. It does not delete records or logs.
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
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
