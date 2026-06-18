"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  formatTime,
  readJsonResponse,
  type PanelMessage,
} from "@/components/control-panel-client";
import { useMeetingSession } from "@/components/meeting-session-context";
import { isBotActiveStatus } from "@/lib/bot-status";
import type {
  LiveChatLog,
  LiveChatTemplate,
  RecallBotRecord,
  ScheduledBotJoin,
} from "@/lib/types";

type OverviewData = {
  recallBots: RecallBotRecord[];
  scheduledBotJoins: ScheduledBotJoin[];
  liveChatTemplates: LiveChatTemplate[];
  liveChatLogs: LiveChatLog[];
};

const initialOverviewData: OverviewData = {
  recallBots: [],
  scheduledBotJoins: [],
  liveChatTemplates: [],
  liveChatLogs: [],
};

export function OverviewPageClient() {
  const { currentSession, currentSessionId } = useMeetingSession();
  const [data, setData] = useState<OverviewData>(initialOverviewData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [stoppingAllBots, setStoppingAllBots] = useState(false);

  const activeBotsCount = useMemo(
    () => data.recallBots.filter((bot) => isBotActiveStatus(bot.status)).length,
    [data.recallBots],
  );
  const latestLiveChatLogs = data.liveChatLogs.slice(0, 5);
  const latestBots = data.recallBots.slice(0, 5);
  const latestScheduledBotJoins = data.scheduledBotJoins.slice(0, 5);
  const latestLiveChatTemplates = data.liveChatTemplates.slice(0, 5);

  async function loadOverviewData() {
    const [botsResponse, scheduledResponse, templatesResponse, logsResponse] =
      await Promise.all([
        fetch(
          `/api/recall/bots?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=200`,
          { cache: "no-store" },
        ),
        fetch(
          `/api/scheduled-bots?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=200`,
          { cache: "no-store" },
        ),
        fetch(
          `/api/live-chat/templates?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=200`,
          { cache: "no-store" },
        ),
        fetch(
          `/api/logs/live-chat?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=200`,
          { cache: "no-store" },
        ),
      ]);

    if (
      !botsResponse.ok ||
      !scheduledResponse.ok ||
      !templatesResponse.ok ||
      !logsResponse.ok
    ) {
      throw new Error("Failed to load dashboard data.");
    }

    const botsPayload = await readJsonResponse<{
      recallBots: RecallBotRecord[];
    }>(botsResponse);
    const scheduledPayload = await readJsonResponse<{
      scheduledBotJoins: ScheduledBotJoin[];
    }>(scheduledResponse);
    const templatesPayload = await readJsonResponse<{
      liveChatTemplates: LiveChatTemplate[];
    }>(templatesResponse);
    const logsPayload = await readJsonResponse<{
      liveChatLogs: LiveChatLog[];
    }>(logsResponse);

    setData({
      recallBots: botsPayload.recallBots,
      scheduledBotJoins: scheduledPayload.scheduledBotJoins,
      liveChatTemplates: templatesPayload.liveChatTemplates,
      liveChatLogs: logsPayload.liveChatLogs,
    });
    setError(null);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        await loadOverviewData();
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load dashboard data.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void loadOverviewData().catch(() => {
        // The next polling cycle can recover without interrupting the page.
      });
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [currentSessionId]);

  async function handleStopAllActiveBots() {
    if (activeBotsCount === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Stop all ${activeBotsCount} active bot(s) in the current session? This does not delete bot records or logs.`,
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
      await loadOverviewData();
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
          <h2>Live chat sender summary</h2>
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
              <span className="stat-label">Scheduled Bots</span>
              <div className="stat-value">{data.scheduledBotJoins.length}</div>
            </div>
            <div className="stat">
              <span className="stat-label">Live Chat Templates</span>
              <div className="stat-value">{data.liveChatTemplates.length}</div>
            </div>
            <div className="stat">
              <span className="stat-label">Live Chat Logs</span>
              <div className="stat-value">{data.liveChatLogs.length}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="page-grid">
        <section className="card">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Latest Bots</h3>
                <p>Newest bot records in the current session.</p>
              </div>
              <Link className="button secondary" href="/bots">
                Open page
              </Link>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading bots...</div>
            ) : latestBots.length === 0 ? (
              <div className="empty">No bots yet.</div>
            ) : (
              <div className="log-list compact-list">
                {latestBots.map((bot) => (
                  <article className="log-item" key={bot.id}>
                    <h3>{bot.botName}</h3>
                    <div className="log-meta">
                      <span className={`pill status-${isBotActiveStatus(bot.status) ? "sent" : "unknown"}`}>
                        {bot.status}
                      </span>
                      <span className="pill">{formatTime(bot.createdAt)}</span>
                    </div>
                    <p className="code">{bot.recallBotId}</p>
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
                <h3>Latest Scheduled Bot Joins</h3>
                <p>Newest scheduled join jobs for this session.</p>
              </div>
              <Link className="button secondary" href="/scheduled-bots">
                Open page
              </Link>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading scheduled bots...</div>
            ) : latestScheduledBotJoins.length === 0 ? (
              <div className="empty">No scheduled bot joins yet.</div>
            ) : (
              <div className="log-list compact-list">
                {latestScheduledBotJoins.map((schedule) => (
                  <article className="log-item" key={schedule.id}>
                    <h3>{schedule.name}</h3>
                    <div className="log-meta">
                      <span className="pill">Status: {schedule.status}</span>
                      <span className="pill">Bots: {schedule.botCount}</span>
                      <span className="pill">
                        {formatTime(schedule.scheduledAt)}
                      </span>
                    </div>
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
                <h3>Latest Live Chat Templates</h3>
                <p>Saved messages ready to send through selected bots.</p>
              </div>
              <Link className="button secondary" href="/live-chat">
                Open page
              </Link>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading templates...</div>
            ) : latestLiveChatTemplates.length === 0 ? (
              <div className="empty">No live chat templates yet.</div>
            ) : (
              <div className="log-list compact-list">
                {latestLiveChatTemplates.map((template) => (
                  <article className="log-item" key={template.id}>
                    <h3>{template.name}</h3>
                    <div className="log-meta">
                      <span className="pill">Mode: {template.senderMode}</span>
                      <span className="pill">{formatTime(template.updatedAt)}</span>
                    </div>
                    <p className="code">{template.message}</p>
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
                <h3>Latest Live Chat Logs</h3>
                <p>Newest send results from saved templates or manual sends.</p>
              </div>
              <Link className="button secondary" href="/live-chat">
                Open page
              </Link>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading live chat logs...</div>
            ) : latestLiveChatLogs.length === 0 ? (
              <div className="empty">No live chat logs yet.</div>
            ) : (
              <div className="log-list compact-list">
                {latestLiveChatLogs.map((log) => (
                  <article className="log-item" key={log.id}>
                    <h3>{formatTime(log.createdAt)}</h3>
                    <div className="log-meta">
                      <span className={`pill status-${log.status}`}>
                        {log.status}
                      </span>
                      <span className="pill">Mode: {log.senderMode}</span>
                    </div>
                    <p className="code">{log.message}</p>
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
