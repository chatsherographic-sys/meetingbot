"use client";

import Link from "next/link";
import { useState } from "react";
import {
  formatTime,
  readJsonResponse,
  type PanelMessage,
  useControlPanelData,
} from "@/components/control-panel-client";
import { useMeetingSession } from "@/components/meeting-session-context";
import { isBotActiveStatus } from "@/lib/bot-status";

export function OverviewPageClient() {
  const { currentSession, currentSessionId } = useMeetingSession();
  const { data, error, loading, reload } = useControlPanelData({
    pollMs: 3000,
    sessionId: currentSessionId,
  });
  const latestWebhookDebugLogs = data.webhookDebugLogs.slice(0, 5);
  const latestTranscriptLogs = data.transcriptLogs.slice(0, 5);
  const latestMatchLogs = data.matchLogs.slice(0, 5);
  const activeBotsCount = data.recallBots.filter((bot) =>
    isBotActiveStatus(bot.status),
  ).length;
  const [message, setMessage] = useState<PanelMessage>(null);
  const [stoppingAllBots, setStoppingAllBots] = useState(false);

  async function handleStopAllActiveBots() {
    if (activeBotsCount === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Stop all ${activeBotsCount} active bot(s)? This does not delete bot records or logs.`,
    );

    if (!confirmed) {
      return;
    }

    setStoppingAllBots(true);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/recall/bots/stop-all?sessionId=${encodeURIComponent(currentSessionId)}`,
        {
        method: "POST",
        },
      );
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
        text: `Stopped ${payload.stoppedCount} of ${payload.totalActiveBots} active bot(s).${failureSummary}`,
      });
      await reload();
    } catch (stopError) {
      setMessage({
        type: "error",
        text:
          stopError instanceof Error
            ? stopError.message
            : "Failed to stop all active bots.",
      });
    } finally {
      setStoppingAllBots(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Overview</p>
          <h2>Control panel summary</h2>
          <p className="muted">
            Current session: {currentSession?.name ?? "Default Session"}
          </p>
        </div>
      </section>

      {error ? <p className="message error">{error}</p> : null}
      {message ? <p className={`message ${message.type}`}>{message.text}</p> : null}

      <section className="card">
        <div className="card-body">
          <div className="actions">
            <button
              className="button secondary"
              type="button"
              disabled={stoppingAllBots || activeBotsCount === 0}
              onClick={() => void handleStopAllActiveBots()}
            >
              {stoppingAllBots ? "Stopping..." : "Stop All Active Bots"}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-body">
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Active Bots</span>
              <div className="stat-value">{activeBotsCount}</div>
            </div>
            <div className="stat">
              <span className="stat-label">Trigger Rules</span>
              <div className="stat-value">{data.triggerRules.length}</div>
            </div>
            <div className="stat">
              <span className="stat-label">Timer Trigger Rules</span>
              <div className="stat-value">{data.timerTriggers.length}</div>
            </div>
            <div className="stat">
              <span className="stat-label">Webhook Logs</span>
              <div className="stat-value">{data.webhookDebugLogs.length}</div>
            </div>
            <div className="stat">
              <span className="stat-label">Transcript Logs</span>
              <div className="stat-value">{data.transcriptLogs.length}</div>
            </div>
            <div className="stat">
              <span className="stat-label">Matched Triggers</span>
              <div className="stat-value">{data.matchLogs.length}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="page-grid">
        <section className="card">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Latest Webhook Debug Logs</h3>
                <p>Newest first, with transcript snippets when available.</p>
              </div>
              <Link className="button secondary" href="/webhooks">
                Open page
              </Link>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading webhook logs...</div>
            ) : latestWebhookDebugLogs.length === 0 ? (
              <div className="empty">No webhook debug logs yet.</div>
            ) : (
              <div className="log-list compact-list">
                {latestWebhookDebugLogs.map((log) => (
                  <article className="log-item" key={log.id}>
                    <h3>{log.eventName}</h3>
                    <div className="log-meta">
                      <span className={`pill status-${log.status}`}>
                        {log.status}
                      </span>
                      <span className="pill">Bot: {log.botId ?? "Unknown"}</span>
                      <span className="pill">{formatTime(log.receivedAt)}</span>
                    </div>
                    {log.extractedTranscriptText ? (
                      <p className="code">
                        Transcript: {log.extractedTranscriptText}
                      </p>
                    ) : null}
                    {log.errorMessage ? (
                      <p className="code error-text">Error: {log.errorMessage}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Latest Transcript Logs</h3>
                <p>Recent extracted transcript text and match counts.</p>
              </div>
              <Link className="button secondary" href="/transcripts">
                Open page
              </Link>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading transcript logs...</div>
            ) : latestTranscriptLogs.length === 0 ? (
              <div className="empty">No transcript logs yet.</div>
            ) : (
              <div className="log-list compact-list">
                {latestTranscriptLogs.map((log) => (
                  <article className="log-item" key={log.id}>
                    <h3>{formatTime(log.createdAt)}</h3>
                    <div className="log-meta">
                      <span className="pill">Bot: {log.botId ?? "Unknown"}</span>
                      <span className="pill">Event: {log.sourceEvent}</span>
                      <span className="pill">
                        Matched rules: {log.matchedRuleIds.length}
                      </span>
                    </div>
                    <p className="code">
                      {log.transcriptText || "(empty transcript)"}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Latest Matched Trigger Logs</h3>
                <p>See the latest dry-run, sent, or failed chat actions.</p>
              </div>
              <Link className="button secondary" href="/matched-triggers">
                Open page
              </Link>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading matched trigger logs...</div>
            ) : latestMatchLogs.length === 0 ? (
              <div className="empty">No matched trigger logs yet.</div>
            ) : (
              <div className="log-list compact-list">
                {latestMatchLogs.map((log) => (
                  <article className="log-item" key={log.id}>
                    <h3>{log.triggerPhrase}</h3>
                    <p className="code">{log.action}</p>
                    <div className="log-meta">
                      <span className={`pill status-${log.status}`}>
                        {log.status}
                      </span>
                      <span className="pill">Bot: {log.botId ?? "Unknown"}</span>
                      <span className="pill">{formatTime(log.createdAt)}</span>
                    </div>
                    {log.errorMessage ? (
                      <p className="code error-text">Error: {log.errorMessage}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
