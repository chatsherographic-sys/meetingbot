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
  LiveChatTemplate,
  RecallBotRecord,
} from "@/lib/types";

type LiveChatTemplateFormState = {
  name: string;
  message: string;
  senderMode: LiveChatTemplate["senderMode"];
  botIds: string[];
};

const initialFormState: LiveChatTemplateFormState = {
  name: "",
  message: "",
  senderMode: "selected_bots",
  botIds: [],
};

function formatTemplateSenderMode(
  senderMode: LiveChatTemplate["senderMode"],
): string {
  if (senderMode === "all_bots") {
    return "All Active Bots";
  }

  if (senderMode === "round_robin") {
    return "Round Robin";
  }

  return "Selected Bots";
}

export function LiveChatPageClient() {
  const { currentSession, currentSessionId, loading: sessionLoading } =
    useMeetingSession();
  const [formState, setFormState] =
    useState<LiveChatTemplateFormState>(initialFormState);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [liveChatTemplates, setLiveChatTemplates] = useState<LiveChatTemplate[]>([]);
  const [liveChatLogs, setLiveChatLogs] = useState<LiveChatLog[]>([]);
  const [recallBots, setRecallBots] = useState<RecallBotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sendingTemplateId, setSendingTemplateId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [error, setError] = useState<string | null>(null);

  const selectableBots = useMemo(
    () => recallBots.filter((bot) => isBotActiveStatus(bot.status)),
    [recallBots],
  );
  const currentSessionBlockedMessage = getSessionOperationBlockedMessage(
    currentSession?.status,
  );

  async function loadLiveChatData() {
    const [templatesResponse, logsResponse, botsResponse] = await Promise.all([
      fetch(
        `/api/live-chat/templates?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=200`,
        { cache: "no-store" },
      ),
      fetch(
        `/api/logs/live-chat?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=200`,
        { cache: "no-store" },
      ),
      fetch(
        `/api/recall/bots?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=200`,
        { cache: "no-store" },
      ),
    ]);

    if (!templatesResponse.ok || !logsResponse.ok || !botsResponse.ok) {
      throw new Error("Failed to load live chat data.");
    }

    const templatesPayload = await readJsonResponse<{
      liveChatTemplates: LiveChatTemplate[];
    }>(templatesResponse);
    const logsPayload = await readJsonResponse<{
      liveChatLogs: LiveChatLog[];
    }>(logsResponse);
    const botsPayload = await readJsonResponse<{
      recallBots: RecallBotRecord[];
    }>(botsResponse);

    setLiveChatTemplates(templatesPayload.liveChatTemplates);
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

  const selectedBotsSummary = useMemo(() => {
    return selectableBots.filter((bot) => formState.botIds.includes(bot.recallBotId));
  }, [selectableBots, formState.botIds]);

  function getBotDisplayName(botId: string): string {
    const bot = recallBots.find((item) => item.recallBotId === botId);
    return bot ? `${bot.botName} (${bot.recallBotId})` : `${botId} (missing)`;
  }

  function resetForm() {
    setFormState(initialFormState);
    setEditingTemplateId(null);
  }

  function toggleSelectedBot(botId: string) {
    setFormState((current) => ({
      ...current,
      botIds: current.botIds.includes(botId)
        ? current.botIds.filter((value) => value !== botId)
        : [...current.botIds, botId],
    }));
  }

  function startEditingTemplate(template: LiveChatTemplate) {
    setEditingTemplateId(template.id);
    setFormState({
      name: template.name,
      message: template.message,
      senderMode: template.senderMode,
      botIds: template.botIds,
    });
    setMessage(null);
  }

  async function handleSaveTemplate() {
    setSavingTemplate(true);
    setMessage(null);

    try {
      const endpoint = editingTemplateId
        ? `/api/live-chat/templates/${editingTemplateId}`
        : "/api/live-chat/templates";
      const method = editingTemplateId ? "PATCH" : "POST";
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: currentSessionId,
          name: formState.name,
          message: formState.message,
          senderMode: formState.senderMode,
          botIds: formState.senderMode === "all_bots" ? [] : formState.botIds,
        }),
      });
      const payload = await readJsonResponse<{
        error?: string;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save live chat template.");
      }

      setMessage({
        type: "success",
        text: editingTemplateId
          ? "Live chat template updated."
          : "Live chat template created.",
      });
      resetForm();
      await loadLiveChatData();
    } catch (saveError) {
      setMessage({
        type: "error",
        text:
          saveError instanceof Error
            ? saveError.message
            : "Failed to save live chat template.",
      });
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleSendTemplate(templateId: string) {
    setSendingTemplateId(templateId);
    setMessage(null);

    try {
      const response = await fetch(`/api/live-chat/templates/${templateId}/send`, {
        method: "POST",
      });
      const payload = await readJsonResponse<{
        error?: string;
        liveChatLog?: LiveChatLog;
        template?: LiveChatTemplate;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to send live chat template.");
      }

      setMessage({
        type:
          payload.liveChatLog?.status === "failed" ||
          payload.liveChatLog?.status === "no_active_sender_bot"
            ? "error"
            : "success",
        text: `Template "${payload.template?.name ?? "Live Chat"}" send ${payload.liveChatLog?.status ?? "completed"}.`,
      });
      await loadLiveChatData();
    } catch (sendError) {
      setMessage({
        type: "error",
        text:
          sendError instanceof Error
            ? sendError.message
            : "Failed to send live chat template.",
      });
    } finally {
      setSendingTemplateId(null);
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    const confirmed = window.confirm(
      "Delete this live chat template? This cannot be undone.",
    );

    if (!confirmed) {
      return;
    }

    setDeletingTemplateId(templateId);
    setMessage(null);

    try {
      const response = await fetch(`/api/live-chat/templates/${templateId}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete live chat template.");
      }

      if (editingTemplateId === templateId) {
        resetForm();
      }

      setMessage({
        type: "success",
        text: "Live chat template deleted.",
      });
      await loadLiveChatData();
    } catch (deleteError) {
      setMessage({
        type: "error",
        text:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete live chat template.",
      });
    } finally {
      setDeletingTemplateId(null);
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

  function getTemplateBotSummary(template: LiveChatTemplate): string {
    if (template.senderMode === "all_bots") {
      return "All active bots in the current session";
    }

    if (template.senderMode === "round_robin") {
      if (template.botIds.length === 0) {
        return "Rotates through all active bots in the current session";
      }

      return `Rotates through selected active bots: ${template.botIds
        .map((botId) => getBotDisplayName(botId))
        .join(", ")}`;
    }

    if (template.botIds.length === 0) {
      return "No bots selected";
    }

    return template.botIds.map((botId) => getBotDisplayName(botId)).join(", ");
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Live Chat</p>
          <h2>Template-based Zoom chat sender</h2>
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
            <h3>{editingTemplateId ? "Edit Live Chat Template" : "Create Live Chat Template"}</h3>
            <p>Save reusable Zoom chat messages and send them through selected bots.</p>
          </div>
          <div className="card-body">
            <div className="form">
              <div className="field">
                <label htmlFor="live-chat-template-name">Template name</label>
                <input
                  id="live-chat-template-name"
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. New Student Follow-up"
                />
              </div>

              <div className="field">
                <label htmlFor="live-chat-template-message">Message</label>
                <textarea
                  id="live-chat-template-message"
                  value={formState.message}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                  placeholder="Type the Zoom chat message template..."
                />
              </div>

              <div className="field">
                <label htmlFor="live-chat-template-sender-mode">Sender mode</label>
                <select
                  id="live-chat-template-sender-mode"
                  value={formState.senderMode}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      senderMode:
                        event.target.value === "all_bots"
                          ? "all_bots"
                          : event.target.value === "round_robin"
                            ? "round_robin"
                            : "selected_bots",
                    }))
                  }
                >
                  <option value="selected_bots">Selected Bots</option>
                  <option value="round_robin">Round Robin</option>
                  <option value="all_bots">All Active Bots</option>
                </select>
                {formState.senderMode === "all_bots" ? (
                  <p className="muted">
                    This template will send once through every active bot in the
                    current session.
                  </p>
                ) : formState.senderMode === "round_robin" ? (
                  <p className="muted">
                    This template sends through only one bot per click and rotates
                    each time. If no bots are selected here, it uses all active bots
                    in the current session.
                  </p>
                ) : (
                  <p className="muted">
                    This template will send only through the selected active or
                    created bots in the current session.
                  </p>
                )}
              </div>

              <div className="field">
                <label>Selected bots</label>
                {selectableBots.length === 0 ? (
                  <div className="empty">No active or created bots right now.</div>
                ) : (
                  <div className="choice-list">
                    {selectableBots.map((bot) => (
                      <label className="choice-item" key={bot.id}>
                        <input
                          type="checkbox"
                          disabled={formState.senderMode === "all_bots"}
                          checked={formState.botIds.includes(bot.recallBotId)}
                          onChange={() => toggleSelectedBot(bot.recallBotId)}
                        />
                        <span>
                          {bot.botName} ({bot.recallBotId})
                        </span>
                        <span className="muted">Status: {bot.status}</span>
                      </label>
                    ))}
                  </div>
                )}
                {formState.senderMode === "selected_bots" ? (
                  selectedBotsSummary.length > 0 ? (
                    <p className="code">
                      Selected bots:{" "}
                      {selectedBotsSummary
                        .map((bot) => `${bot.botName} (${bot.recallBotId})`)
                        .join(", ")}
                    </p>
                  ) : (
                    <p className="message warning">
                      No bots selected yet. You can still save the template, but
                      sending will fail until bots are assigned.
                    </p>
                  )
                ) : formState.senderMode === "round_robin" ? (
                  selectedBotsSummary.length > 0 ? (
                    <p className="code">
                      Round robin pool:{" "}
                      {selectedBotsSummary
                        .map((bot) => `${bot.botName} (${bot.recallBotId})`)
                        .join(", ")}
                    </p>
                  ) : (
                    <p className="code">
                      No bots selected. Round robin will use all active bots in the
                      current session.
                    </p>
                  )
                ) : (
                  <p className="code">Bot selection is ignored in all_bots mode.</p>
                )}
              </div>

              <div className="actions">
                <button
                  className="button"
                  type="button"
                  disabled={
                    savingTemplate ||
                    Boolean(currentSessionBlockedMessage) ||
                    !formState.name.trim() ||
                    !formState.message.trim()
                  }
                  onClick={() => void handleSaveTemplate()}
                >
                  {savingTemplate
                    ? editingTemplateId
                      ? "Saving..."
                      : "Creating..."
                    : editingTemplateId
                      ? "Save Template"
                      : "Create Template"}
                </button>
                {editingTemplateId ? (
                  <button
                    className="button secondary"
                    type="button"
                    disabled={savingTemplate}
                    onClick={resetForm}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <div className="side-stack">
          <section className="card">
            <div className="card-header">
              <h3>Current Session</h3>
              <p>Templates belong only to the current selected session.</p>
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
                  <span className="setting-label">Selectable Bots</span>
                  <span className="setting-value">{selectableBots.length}</span>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Templates</span>
                  <span className="setting-value">{liveChatTemplates.length}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h3>Send Notes</h3>
            </div>
            <div className="card-body">
              <ul className="helper-list">
                <li>`Selected Bots` sends only through the bots saved on the template.</li>
                <li>`Round Robin` sends through one bot per click and rotates through the saved active bot pool.</li>
                <li>`All Active Bots` sends once through every active bot in the current session.</li>
                <li>Dry-run and real send still follow `RECALL_SEND_CHAT_ENABLED`.</li>
              </ul>
            </div>
          </section>
        </div>

        <section className="card form-shell-span">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Live Chat Templates</h3>
                <p>Send saved Zoom chat messages without retyping them each time.</p>
              </div>
              <button
                className="button secondary"
                type="button"
                onClick={() => void loadLiveChatData()}
              >
                Refresh data
              </button>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading templates...</div>
            ) : liveChatTemplates.length === 0 ? (
              <div className="empty">No live chat templates yet.</div>
            ) : (
              <div className="rule-list">
                {liveChatTemplates.map((template) => (
                  <article className="rule-item" key={template.id}>
                    <h3>{template.name}</h3>
                    <p className="code">{template.message}</p>
                    <div className="rule-meta">
                      <span className="pill">
                        Sender mode: {formatTemplateSenderMode(template.senderMode)}
                      </span>
                      <span className="pill">
                        Created: {formatTime(template.createdAt)}
                      </span>
                      <span className="pill">
                        Updated: {formatTime(template.updatedAt)}
                      </span>
                    </div>
                    <p className="muted">{getTemplateBotSummary(template)}</p>
                    {template.senderMode === "round_robin" ? (
                      <div className="rule-meta">
                        <span className="pill">
                          Last sent bot:{" "}
                          {template.lastSentBotId
                            ? getBotDisplayName(template.lastSentBotId)
                            : "None yet"}
                        </span>
                        <span className="pill">
                          Last sent at:{" "}
                          {template.lastSentAt ? formatTime(template.lastSentAt) : "Never"}
                        </span>
                        <span className="pill">
                          Next index: {template.roundRobinIndex}
                        </span>
                      </div>
                    ) : null}
                    <div className="actions">
                      <button
                        className="button"
                        type="button"
                        disabled={sendingTemplateId === template.id}
                        onClick={() => void handleSendTemplate(template.id)}
                      >
                        {sendingTemplateId === template.id ? "Sending..." : "Send"}
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => startEditingTemplate(template)}
                      >
                        Edit
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={deletingTemplateId === template.id}
                        onClick={() => void handleDeleteTemplate(template.id)}
                      >
                        {deletingTemplateId === template.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card form-shell-span">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Live Chat Logs</h3>
                <p>Newest first. These logs are historical send records.</p>
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
                      <span className="pill">
                        Sender mode: {log.senderMode.replaceAll("_", " ")}
                      </span>
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
