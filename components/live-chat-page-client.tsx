"use client";

import { useEffect, useMemo, useState } from "react";
import { isBotActiveStatus } from "@/lib/bot-status";
import {
  formatTime,
  readJsonResponse,
  type PanelMessage,
} from "@/components/control-panel-client";
import { useMeetingSession } from "@/components/meeting-session-context";
import { getSessionOperationBlockedMessage } from "@/lib/session-operations";
import type {
  LiveChatLog,
  RecallBotRecord,
  SenderMode,
} from "@/lib/types";

type LiveChatFormState = {
  message: string;
  senderMode: SenderMode;
  senderBotIds: string[];
};

const initialFormState: LiveChatFormState = {
  message: "",
  senderMode: "round_robin_bots",
  senderBotIds: [],
};

export function LiveChatPageClient() {
  const { currentSession, currentSessionId, loading: sessionLoading } =
    useMeetingSession();
  const [formState, setFormState] = useState<LiveChatFormState>(initialFormState);
  const [liveChatLogs, setLiveChatLogs] = useState<LiveChatLog[]>([]);
  const [recallBots, setRecallBots] = useState<RecallBotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [error, setError] = useState<string | null>(null);

  const activeBots = useMemo(
    () => recallBots.filter((bot) => isBotActiveStatus(bot.status)),
    [recallBots],
  );
  const currentSessionBlockedMessage = getSessionOperationBlockedMessage(
    currentSession?.status,
  );
  const selectedActiveBots = useMemo(
    () =>
      activeBots.filter((bot) => formState.senderBotIds.includes(bot.recallBotId)),
    [activeBots, formState.senderBotIds],
  );

  async function loadLiveChatData() {
    const [logsResponse, botsResponse] = await Promise.all([
      fetch(
        `/api/logs/live-chat?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=200`,
        { cache: "no-store" },
      ),
      fetch(
        `/api/recall/bots?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=200`,
        { cache: "no-store" },
      ),
    ]);

    if (!logsResponse.ok || !botsResponse.ok) {
      throw new Error("Failed to load live chat data.");
    }

    const logsPayload = await readJsonResponse<{
      liveChatLogs: LiveChatLog[];
    }>(logsResponse);
    const botsPayload = await readJsonResponse<{
      recallBots: RecallBotRecord[];
    }>(botsResponse);

    setLiveChatLogs(logsPayload.liveChatLogs);
    setRecallBots(botsPayload.recallBots);
    setError(null);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        await loadLiveChatData();
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load live chat data.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [currentSessionId]);

  function toggleSenderBot(senderBotId: string) {
    setFormState((current) => ({
      ...current,
      senderBotIds: current.senderBotIds.includes(senderBotId)
        ? current.senderBotIds.filter((botId) => botId !== senderBotId)
        : [...current.senderBotIds, senderBotId],
    }));
  }

  async function handleSendLiveChat() {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/live-chat/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: currentSessionId,
          message: formState.message,
          senderMode: formState.senderMode,
          senderBotIds:
            formState.senderMode === "specific_bots" ? formState.senderBotIds : [],
        }),
      });
      const payload = await readJsonResponse<{
        error?: string;
        liveChatLog?: LiveChatLog;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to send live chat.");
      }

      setMessage({
        type:
          payload.liveChatLog?.status === "failed" ||
          payload.liveChatLog?.status === "no_active_sender_bot"
            ? "error"
            : "success",
        text: `Live chat ${payload.liveChatLog?.status ?? "completed"}.`,
      });
      setFormState((current) => ({
        ...current,
        message: "",
      }));
      await loadLiveChatData();
    } catch (sendError) {
      setMessage({
        type: "error",
        text:
          sendError instanceof Error
            ? sendError.message
            : "Failed to send live chat.",
      });
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteLiveChatLog(logId: string) {
    setMessage(null);

    try {
      const response = await fetch(`/api/logs/live-chat/${logId}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete live chat log.");
      }

      setMessage({
        type: "success",
        text: "Live chat log deleted.",
      });
      await loadLiveChatData();
    } catch (deleteError) {
      setMessage({
        type: "error",
        text:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete live chat log.",
      });
    }
  }

  async function handleClearLiveChatLogs() {
    setMessage(null);

    try {
      const response = await fetch(
        `/api/logs/live-chat?sessionId=${encodeURIComponent(currentSessionId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to clear live chat logs.");
      }

      setMessage({
        type: "success",
        text: "Live chat logs cleared.",
      });
      await loadLiveChatData();
    } catch (clearError) {
      setMessage({
        type: "error",
        text:
          clearError instanceof Error
            ? clearError.message
            : "Failed to clear live chat logs.",
      });
    }
  }

  const specificBotsBlocked =
    formState.senderMode === "specific_bots" && selectedActiveBots.length === 0;

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Live Chat</p>
          <h2>Manual real-time Zoom chat</h2>
          <p className="muted">
            Current session: {currentSession?.name ?? "Default Session"}
          </p>
        </div>
      </section>

      {error ? <p className="message error">{error}</p> : null}
      {!currentSession && !sessionLoading ? (
        <p className="message error">
          Please select a session from the navigation bar first.
        </p>
      ) : null}
      {currentSessionBlockedMessage ? (
        <p className="message error">{currentSessionBlockedMessage}</p>
      ) : null}
      {message ? <p className={`message ${message.type}`}>{message.text}</p> : null}

      <div className="form-shell">
        <section className="card">
          <div className="card-header">
            <h3>Send Live Chat</h3>
            <p>Dry-run and real send modes follow `RECALL_SEND_CHAT_ENABLED`.</p>
          </div>
          <div className="card-body">
            <div className="form">
              <div className="field">
                <label htmlFor="live-chat-message">Message</label>
                <textarea
                  id="live-chat-message"
                  value={formState.message}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                  placeholder="Type a live Zoom chat message..."
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="live-chat-sender-mode">Sender Mode</label>
                <select
                  id="live-chat-sender-mode"
                  value={formState.senderMode}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      senderMode: event.target.value as SenderMode,
                      senderBotIds:
                        event.target.value === "specific_bots"
                          ? current.senderBotIds
                          : [],
                    }))
                  }
                >
                  <option value="round_robin_bots">Round-robin bot(s)</option>
                  <option value="specific_bots">Specific bot(s)</option>
                  <option value="all_bots">All bot(s)</option>
                </select>
                {formState.senderMode === "round_robin_bots" ? (
                  <p className="muted">
                    One active bot sends at a time, rotating after each accepted
                    live send.
                  </p>
                ) : null}
                {formState.senderMode === "all_bots" ? (
                  <p className="muted">
                    All active bots will send this message once each.
                  </p>
                ) : null}
              </div>

              {formState.senderMode === "specific_bots" ? (
                <div className="field">
                  <label>Specific sender bot(s)</label>
                  {activeBots.length === 0 ? (
                    <div className="empty">No active bots right now.</div>
                  ) : (
                    <div className="choice-list">
                      {activeBots.map((bot) => (
                        <label className="choice-item" key={bot.id}>
                          <input
                            type="checkbox"
                            checked={formState.senderBotIds.includes(
                              bot.recallBotId,
                            )}
                            onChange={() => toggleSenderBot(bot.recallBotId)}
                          />
                          <span>
                            {bot.botName} ({bot.recallBotId})
                          </span>
                          <span className="muted">Status: {bot.status}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {selectedActiveBots.length > 0 ? (
                    <p className="code">
                      Selected active bots:{" "}
                      {selectedActiveBots
                        .map((bot) => `${bot.botName} (${bot.recallBotId})`)
                        .join(", ")}
                    </p>
                  ) : (
                    <p className="message error">
                      No bots assigned yet. Live chat cannot send until at least
                      one active bot is selected.
                    </p>
                  )}
                </div>
              ) : (
                <div className="field">
                  <label>Active sender pool</label>
                  {activeBots.length === 0 ? (
                    <div className="empty">No active bots right now.</div>
                  ) : (
                    <div className="choice-list">
                      {activeBots.map((bot) => (
                        <div className="choice-item" key={bot.id}>
                          <span>
                            {bot.botName} ({bot.recallBotId})
                          </span>
                          <span className="muted">Status: {bot.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="actions">
                <button
                  className="button"
                  type="button"
                  disabled={
                    sending ||
                    Boolean(currentSessionBlockedMessage) ||
                    !formState.message.trim() ||
                    (formState.senderMode === "specific_bots" && specificBotsBlocked)
                  }
                  onClick={() => void handleSendLiveChat()}
                >
                  {sending ? "Sending..." : "Send Live Chat"}
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="side-stack">
          <section className="card">
            <div className="card-header">
              <h3>Current Session</h3>
              <p>Live chat sends only through active bots in this session.</p>
            </div>
            <div className="card-body">
              <div className="editor-context">
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
                  <span className="setting-label">Active Bots</span>
                  <span className="setting-value">{activeBots.length}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h3>Sender Notes</h3>
            </div>
            <div className="card-body">
              <ul className="helper-list">
                <li>Round-robin sends from one active bot at a time.</li>
                <li>Specific bots requires at least one selected active bot.</li>
                <li>All bots sends the message once from every active bot.</li>
              </ul>
              {activeBots.length === 0 ? (
                <p className="message warning">
                  No active bots are available yet. Live chat will wait until bots are active.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="card form-shell-span">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Live Chat Logs</h3>
                <p>Newest first. These logs are historical records.</p>
              </div>
              <div className="actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void loadLiveChatData()}
                >
                  Refresh data
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void handleClearLiveChatLogs()}
                >
                  Clear All Live Chat Logs
                </button>
              </div>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading live chat logs...</div>
            ) : liveChatLogs.length === 0 ? (
              <div className="empty">No live chat logs yet.</div>
            ) : (
              <div className="log-list">
                {liveChatLogs.map((log) => (
                  <article className="log-item" key={log.id}>
                    <h3>{formatTime(log.createdAt)}</h3>
                    <div className="log-meta">
                      <span className={`pill status-${log.status}`}>
                        Status: {log.status}
                      </span>
                      <span className="pill">Sender mode: {log.senderMode}</span>
                      <span className="pill">
                        Sender bots:{" "}
                        {log.senderBotIdsUsed.length > 0
                          ? log.senderBotIdsUsed.join(", ")
                          : "None"}
                      </span>
                    </div>
                    <p className="code">{log.message}</p>
                    <div className="result-stack">
                      {log.senderResults.map((senderResult, index) => (
                        <div className="log-item" key={`${log.id}-${index}`}>
                          <div className="log-meta">
                            <span className={`pill status-${senderResult.status}`}>
                              {senderResult.status}
                            </span>
                            <span className="pill">
                              Sender:{" "}
                              {senderResult.senderBotName ??
                                senderResult.senderBotId ??
                                "None"}
                            </span>
                          </div>
                          <p className="code">{senderResult.action}</p>
                          {senderResult.errorMessage ? (
                            <p className="code error-text">
                              Error: {senderResult.errorMessage}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {log.errorMessage ? (
                      <p className="code error-text">Error: {log.errorMessage}</p>
                    ) : null}
                    <div className="actions">
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => void handleDeleteLiveChatLog(log.id)}
                      >
                        Delete
                      </button>
                    </div>
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
