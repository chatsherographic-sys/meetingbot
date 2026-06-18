"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  buildQueryString,
  formatTime,
  isDocumentVisible,
  type ListPagination,
  readJsonResponse,
  type PanelMessage,
} from "@/components/control-panel-client";
import { useMeetingSession } from "@/components/meeting-session-context";
import { isBotActiveStatus } from "@/lib/bot-status";
import { getSessionOperationBlockedMessage } from "@/lib/session-operations";
import type { RecallBotRecord } from "@/lib/types";

type BotsPageClientProps = {
  preflightErrors: string[];
  preflightWarnings: string[];
};

type BulkCreateResult = {
  successfulBots: Array<{
    index: number;
    recallBot: RecallBotRecord;
  }>;
  failedAttempts: Array<{
    index: number;
    botName: string;
    error: string;
  }>;
} | null;

const DEFAULT_BOT_NAME_PREFIX = "ChatsHero AI Assistant";

function createDefaultBotFormState() {
  return {
    botNamePrefix: DEFAULT_BOT_NAME_PREFIX,
    transcriptLanguage: "zh-CN",
    botCount: "1",
    botNames: [DEFAULT_BOT_NAME_PREFIX],
  };
}

function buildDefaultBotNames(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    count === 1 ? prefix : `${prefix} ${index + 1}`,
  );
}

export function BotsPageClient({
  preflightErrors,
  preflightWarnings,
}: BotsPageClientProps) {
  const { currentSession, currentSessionId } = useMeetingSession();
  const [bots, setBots] = useState<RecallBotRecord[]>([]);
  const [hasRefreshableBots, setHasRefreshableBots] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [botSubmitting, setBotSubmitting] = useState(false);
  const [botActionBotId, setBotActionBotId] = useState<string | null>(null);
  const [stoppingAllBots, setStoppingAllBots] = useState(false);
  const [deletingHistoryBotId, setDeletingHistoryBotId] = useState<string | null>(
    null,
  );
  const [clearingHistoryBots, setClearingHistoryBots] = useState(false);
  const [botMessage, setBotMessage] = useState<PanelMessage>(null);
  const [bulkCreateResult, setBulkCreateResult] = useState<BulkCreateResult>(null);
  const [botIdSearch, setBotIdSearch] = useState("");
  const [botNameSearch, setBotNameSearch] = useState("");
  const [meetingUrlSearch, setMeetingUrlSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedBotTab, setSelectedBotTab] = useState<"active" | "history">(
    "active",
  );
  const [botForm, setBotForm] = useState(createDefaultBotFormState);
  const previousBotCountRef = useRef(1);
  const previousBotNamePrefixRef = useRef(DEFAULT_BOT_NAME_PREFIX);
  const isRefreshAllInFlightRef = useRef(false);

  const activeBots = useMemo(
    () => bots.filter((bot) => isBotActiveStatus(bot.status)),
    [bots],
  );
  const historyBots = useMemo(
    () => bots.filter((bot) => !isBotActiveStatus(bot.status)),
    [bots],
  );
  const currentSessionHasZoomUrl = Boolean(currentSession?.zoomUrl.trim());
  const currentSessionBlockedMessage = getSessionOperationBlockedMessage(
    currentSession?.status,
  );
  const createBotBlocked =
    botSubmitting ||
    !currentSessionHasZoomUrl ||
    Boolean(currentSessionBlockedMessage) ||
    preflightErrors.length > 0;

  useEffect(() => {
    const parsedCount = Math.min(
      20,
      Math.max(1, Math.floor(Number(botForm.botCount) || 1)),
    );
    const previousCount = previousBotCountRef.current;
    const previousPrefix = previousBotNamePrefixRef.current;
    const previousDefaults = buildDefaultBotNames(previousPrefix, previousCount);
    const nextDefaults = buildDefaultBotNames(botForm.botNamePrefix, parsedCount);

    setBotForm((current) => {
      const nextBotNames = Array.from({ length: parsedCount }, (_, index) => {
        const existingName = current.botNames[index];
        const previousDefault = previousDefaults[index];
        const nextDefault = nextDefaults[index];

        if (existingName === undefined || existingName === "") {
          return nextDefault;
        }

        if (existingName === previousDefault) {
          return nextDefault;
        }

        return existingName;
      });

      return {
        ...current,
        botNames: nextBotNames,
      };
    });

    previousBotCountRef.current = parsedCount;
    previousBotNamePrefixRef.current = botForm.botNamePrefix;
  }, [botForm.botCount, botForm.botNamePrefix]);

  async function loadBots() {
    const [filteredResponse, allBotsResponse] = await Promise.all([
      fetch(
        `/api/recall/bots${buildQueryString({
          sessionId: currentSessionId,
          botId: botIdSearch,
          name: botNameSearch,
          meetingUrl: meetingUrlSearch,
          status: statusFilter,
        })}`,
        { cache: "no-store" },
      ),
      fetch(
        `/api/recall/bots${buildQueryString({
          pageSize: 200,
          sessionId: currentSessionId,
        })}`,
        {
        cache: "no-store",
        },
      ),
    ]);

    if (!filteredResponse.ok || !allBotsResponse.ok) {
      throw new Error("Failed to load created bots.");
    }

    const filteredPayload = await readJsonResponse<{
      recallBots: RecallBotRecord[];
      pagination: ListPagination;
    }>(filteredResponse);
    const allBotsPayload = await readJsonResponse<{
      recallBots: RecallBotRecord[];
      pagination: ListPagination;
    }>(allBotsResponse);

    setBots(filteredPayload.recallBots);
    setHasRefreshableBots(
      allBotsPayload.recallBots.some((bot) => isBotActiveStatus(bot.status)),
    );
    setError(null);
  }

  async function performRefreshAllStatuses() {
    if (isRefreshAllInFlightRef.current) {
      return;
    }

    isRefreshAllInFlightRef.current = true;

    try {
      const response = await fetch(
        `/api/recall/bots/refresh-all?sessionId=${encodeURIComponent(currentSessionId)}`,
        {
        method: "POST",
        },
      );
      const payload = await readJsonResponse<{
        error?: string;
        totalBots: number;
        refreshedCount: number;
        failedCount: number;
        failedBots: Array<{
          botId: string;
          error: string;
        }>;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to refresh all bot statuses.");
      }

      await loadBots();
    } catch (refreshError) {
      setBotMessage({
        type: "error",
        text:
          refreshError instanceof Error
            ? refreshError.message
            : "Failed to refresh all bot statuses.",
      });
    } finally {
      isRefreshAllInFlightRef.current = false;
    }
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        await loadBots();
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load created bots.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    const interval = window.setInterval(() => {
      if (!isDocumentVisible()) {
        return;
      }

      void loadBots().catch(() => {
        // The next polling cycle can recover without interrupting the page.
      });
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [botIdSearch, botNameSearch, meetingUrlSearch, statusFilter, currentSessionId]);

  useEffect(() => {
    if (!hasRefreshableBots) {
      return;
    }

    const interval = window.setInterval(() => {
      if (!isDocumentVisible()) {
        return;
      }

      void performRefreshAllStatuses();
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [hasRefreshableBots]);

  async function handleCreateBotSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBotSubmitting(true);
    setBotMessage(null);
    setBulkCreateResult(null);

    try {
      if (!currentSessionId) {
        throw new Error("Current session is required before creating bots.");
      }

      if (!currentSessionHasZoomUrl) {
        throw new Error(
          "Current session has no Zoom URL. Please edit the session and add a Zoom URL before creating bots.",
        );
      }

      const response = await fetch("/api/recall/create-bot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...botForm,
          sessionId: currentSessionId,
        }),
      });
      const payload = await readJsonResponse<{
        error?: string;
        recallBot?: RecallBotRecord;
        successfulBots?: Array<{
          index: number;
          recallBot: RecallBotRecord;
        }>;
        failedAttempts?: Array<{
          index: number;
          botName: string;
          error: string;
        }>;
      }>(response);

      if (!response.ok && !payload.successfulBots?.length) {
        throw new Error(payload.error ?? "Failed to create Recall bot.");
      }

      if (payload.recallBot) {
        setBotMessage({
          type: "success",
          text: `Recall bot "${payload.recallBot.botName}" created and saved locally.`,
        });
      } else {
        const successfulBots = payload.successfulBots ?? [];
        const failedAttempts = payload.failedAttempts ?? [];

        setBulkCreateResult({
          successfulBots,
          failedAttempts,
        });

        if (failedAttempts.length > 0) {
          setBotMessage({
            type: "error",
            text: `${successfulBots.length} bot(s) created, ${failedAttempts.length} failed.`,
          });
        } else {
          setBotMessage({
            type: "success",
            text: `${successfulBots.length} bot(s) created and saved locally.`,
          });
        }
      }

      await loadBots();
      await performRefreshAllStatuses();
    } catch (createError) {
      setBotMessage({
        type: "error",
        text:
          createError instanceof Error
            ? createError.message
            : "Failed to create Recall bot.",
      });
    } finally {
      setBotSubmitting(false);
    }
  }

  async function handleRefreshBotStatus(botId: string) {
    setBotActionBotId(botId);
    setBotMessage(null);

    try {
      const response = await fetch(`/api/recall/bots/${botId}/status`, {
        method: "GET",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to refresh bot status.");
      }

      setBotMessage({
        type: "success",
        text: "Bot status refreshed.",
      });
      await loadBots();
    } catch (refreshError) {
      setBotMessage({
        type: "error",
        text:
          refreshError instanceof Error
            ? refreshError.message
            : "Failed to refresh bot status.",
      });
    } finally {
      setBotActionBotId(null);
    }
  }

  async function handleStopBot(botId: string) {
    setBotActionBotId(botId);
    setBotMessage(null);

    try {
      const response = await fetch(`/api/recall/bots/${botId}/stop`, {
        method: "POST",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to stop bot.");
      }

      setBotMessage({
        type: "success",
        text: "Bot leave request sent. Status refreshed if Recall returned an updated state.",
      });
      await loadBots();
    } catch (stopError) {
      setBotMessage({
        type: "error",
        text:
          stopError instanceof Error ? stopError.message : "Failed to stop bot.",
      });
    } finally {
      setBotActionBotId(null);
    }
  }

  async function handleStopAllActiveBots() {
    if (activeBots.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Stop all ${activeBots.length} active bot(s)? This does not delete bot records or logs.`,
    );

    if (!confirmed) {
      return;
    }

    setStoppingAllBots(true);
    setBotMessage(null);

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

      setBotMessage({
        type: payload.failedCount > 0 ? "error" : "success",
        text: `Stopped ${payload.stoppedCount} of ${payload.totalActiveBots} active bot(s).${failureSummary}`,
      });
      await loadBots();
    } catch (stopError) {
      setBotMessage({
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

  async function handleDeleteHistoryBot(botId: string) {
    const confirmed = window.confirm(
      "Delete this history bot record from local storage?",
    );

    if (!confirmed) {
      return;
    }

    setDeletingHistoryBotId(botId);
    setBotMessage(null);

    try {
      const response = await fetch(`/api/recall/bots/${botId}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete bot history record.");
      }

      setBotMessage({
        type: "success",
        text: "Bot history record deleted.",
      });
      await loadBots();
    } catch (deleteError) {
      setBotMessage({
        type: "error",
        text:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete bot history record.",
      });
    } finally {
      setDeletingHistoryBotId(null);
    }
  }

  async function handleClearBotHistory() {
    const confirmed = window.confirm(
      "Clear all history bot records? Active bot records will be kept.",
    );

    if (!confirmed) {
      return;
    }

    setClearingHistoryBots(true);
    setBotMessage(null);

    try {
      const response = await fetch(
        `/api/recall/bots/history?sessionId=${encodeURIComponent(currentSessionId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = await readJsonResponse<{
        error?: string;
        removedCount?: number;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to clear bot history.");
      }

      setBotMessage({
        type: "success",
        text: `Cleared ${payload.removedCount ?? 0} history bot record(s).`,
      });
      await loadBots();
    } catch (clearError) {
      setBotMessage({
        type: "error",
        text:
          clearError instanceof Error
            ? clearError.message
            : "Failed to clear bot history.",
      });
    } finally {
      setClearingHistoryBots(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Bots</p>
          <h2>Create and manage Recall bots</h2>
          <p className="muted">
            Current session: {currentSession?.name ?? "Default Session"}
          </p>
        </div>
      </section>

      {error ? <p className="message error">{error}</p> : null}
      {botMessage ? <p className={`message ${botMessage.type}`}>{botMessage.text}</p> : null}

      <div className="form-shell">
        <section className="card">
          <div className="card-header">
            <h3>Create Recall Bot</h3>
            <p>
              Create Zoom bots for the current sidebar session. Bots join the
              meeting so they can send Zoom chat messages when you use live chat
              templates.
            </p>
          </div>
          <div className="card-body">
            <form className="form" onSubmit={handleCreateBotSubmit}>
              <div className="field">
                <label htmlFor="botCount">Number of Bots</label>
                <input
                  id="botCount"
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  value={botForm.botCount}
                  onChange={(event) =>
                    setBotForm((current) => ({
                      ...current,
                      botCount: event.target.value,
                    }))
                  }
                  required
                />
              </div>

              {Number(botForm.botCount) <= 1 ? (
                <div className="field">
                  <label htmlFor="singleBotName">Bot Name</label>
                  <input
                    id="singleBotName"
                    value={botForm.botNames[0] ?? botForm.botNamePrefix}
                    onChange={(event) =>
                      setBotForm((current) => ({
                        ...current,
                        botNamePrefix: event.target.value,
                        botNames: [event.target.value],
                      }))
                    }
                    required
                  />
                </div>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="botNamePrefix">Bot Name Prefix</label>
                    <input
                      id="botNamePrefix"
                      value={botForm.botNamePrefix}
                      onChange={(event) =>
                        setBotForm((current) => ({
                          ...current,
                          botNamePrefix: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>

                  <div className="bot-name-grid">
                    {botForm.botNames.map((botName, index) => (
                      <div className="field" key={`bot-name-${index + 1}`}>
                        <label htmlFor={`bot-name-${index + 1}`}>
                          Bot {index + 1} Name
                        </label>
                        <input
                          id={`bot-name-${index + 1}`}
                          value={botName}
                          onChange={(event) =>
                            setBotForm((current) => ({
                              ...current,
                              botNames: current.botNames.map((name, nameIndex) =>
                                nameIndex === index ? event.target.value : name,
                              ),
                            }))
                          }
                          required
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
              <p className="helper-text">
                All newly created bots are sender bots for the simplified live
                chat workflow.
              </p>

              <div className="actions">
                <button
                  className="button"
                  type="submit"
                  disabled={createBotBlocked}
                >
                  {botSubmitting ? "Creating..." : "Create Recall Bot"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    {
                      setBotForm(createDefaultBotFormState());
                    }
                  }
                >
                  Reset
                </button>
              </div>
            </form>

            {bulkCreateResult ? (
              <div className="result-stack">
                <div className="result-block">
                  <h4>Successful creations</h4>
                  {bulkCreateResult.successfulBots.length === 0 ? (
                    <p className="muted">No bots were created.</p>
                  ) : (
                    <div className="log-list compact-list">
                      {bulkCreateResult.successfulBots.map((result) => (
                        <article className="log-item" key={result.recallBot.id}>
                          <h3>{result.recallBot.botName}</h3>
                          <div className="log-meta">
                            <span className="pill">Attempt: {result.index}</span>
                            <span className="pill">
                              Bot ID: {result.recallBot.recallBotId}
                            </span>
                            <span className="pill">
                              Status: {result.recallBot.status}
                            </span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>

                {bulkCreateResult.failedAttempts.length > 0 ? (
                  <div className="result-block">
                    <h4>Failed creations</h4>
                    <div className="log-list compact-list">
                      {bulkCreateResult.failedAttempts.map((failure) => (
                        <article
                          className="log-item"
                          key={`${failure.index}-${failure.botName}`}
                        >
                          <h3>{failure.botName}</h3>
                          <div className="log-meta">
                            <span className="pill">Attempt: {failure.index}</span>
                          </div>
                          <p className="code error-text">{failure.error}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

          </div>
        </section>

        <div className="side-stack">
          <section className="card">
            <div className="card-header">
              <h3>Current Session</h3>
              <p>Bot creation always uses the sidebar-selected session.</p>
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
                  <span className="setting-label">Session Zoom URL</span>
                  <span className="setting-value">
                    {currentSession?.zoomUrl || "(empty)"}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h3>Preflight</h3>
              <p>Check these items before creating bots for a live meeting.</p>
            </div>
            <div className="card-body">
              {currentSessionBlockedMessage ? (
                <p className="message error">{currentSessionBlockedMessage}</p>
              ) : null}
              {!currentSessionHasZoomUrl ? (
                <p className="message error">
                  Current session has no Zoom URL. Please edit the session and add a
                  Zoom URL before creating bots.
                </p>
              ) : null}
              {preflightErrors.length > 0 ? (
                <div className="warning-list">
                  {preflightErrors.map((warning) => (
                    <p className="message error" key={warning}>
                      {warning}
                    </p>
                  ))}
                </div>
              ) : null}
              {preflightWarnings.length > 0 ? (
                <div className="warning-list">
                  {preflightWarnings.map((warning) => (
                    <p className="message warning" key={warning}>
                      {warning}
                    </p>
                  ))}
                </div>
              ) : null}
              {preflightErrors.length === 0 &&
              preflightWarnings.length === 0 &&
              currentSessionHasZoomUrl &&
              !currentSessionBlockedMessage ? (
                <p className="message success">
                  Bot creation is ready for the current session.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="card form-shell-span">
          <div className="card-header">
            <h3>Created Bots</h3>
            <p>Saved locally after each create, refresh, or stop action.</p>
          </div>
          <div className="card-body">
            <p className="muted">
              Bot status auto-refresh is active while this page is open.
              {hasRefreshableBots
                ? " Statuses refresh from Recall every 10 seconds while active, created, or joining bots remain."
                : " Auto-refresh is idle until active, created, or joining bots exist again."}
            </p>
            <div className="filters-grid">
              <div className="field">
                <label htmlFor="bot-id-search">Search bot ID</label>
                <input
                  id="bot-id-search"
                  value={botIdSearch}
                  onChange={(event) => setBotIdSearch(event.target.value)}
                  placeholder="fake-bot-id"
                />
              </div>
              <div className="field">
                <label htmlFor="bot-name-search">Search bot name</label>
                <input
                  id="bot-name-search"
                  value={botNameSearch}
                  onChange={(event) => setBotNameSearch(event.target.value)}
                  placeholder="ChatsHero AI Assistant"
                />
              </div>
              <div className="field">
                <label htmlFor="meeting-url-search">Search meeting URL</label>
                <input
                  id="meeting-url-search"
                  value={meetingUrlSearch}
                  onChange={(event) => setMeetingUrlSearch(event.target.value)}
                  placeholder="https://zoom.us/j/..."
                />
              </div>
              <div className="field">
                <label htmlFor="bot-status-filter">Filter status</label>
                <input
                  id="bot-status-filter"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  placeholder="in_call_recording"
                />
              </div>
            </div>
            <div className="tab-row">
              <button
                className={`tab-button ${
                  selectedBotTab === "active" ? "active" : ""
                }`}
                type="button"
                onClick={() => setSelectedBotTab("active")}
              >
                Active Bots ({activeBots.length})
              </button>
              <button
                className={`tab-button ${
                  selectedBotTab === "history" ? "active" : ""
                }`}
                type="button"
                onClick={() => setSelectedBotTab("history")}
              >
                Bot History ({historyBots.length})
              </button>
            </div>
            {loading ? (
              <div className="empty">Loading created bots...</div>
            ) : bots.length === 0 ? (
              <div className="empty">No Recall bots saved yet.</div>
            ) : (
              <div className="result-stack">
                {selectedBotTab === "active" ? (
                  <section className="result-block">
                    <div className="section-row">
                      <div>
                        <h4>Active / In Meeting Bots</h4>
                      </div>
                      <div className="actions">
                        <button
                          className="button secondary"
                          type="button"
                          disabled={stoppingAllBots || activeBots.length === 0}
                          onClick={() => void handleStopAllActiveBots()}
                        >
                          {stoppingAllBots
                            ? "Stopping..."
                            : "Stop All Active Bots"}
                        </button>
                      </div>
                    </div>
                    {activeBots.length === 0 ? (
                      <div className="empty">No active bots match the current filters.</div>
                    ) : (
                      <div className="log-list">
                        {activeBots.map((bot) => (
                          <article className="log-item" key={bot.id}>
                            <h3>{bot.botName}</h3>
                            <div className="log-meta">
                              <span className="pill">Bot ID: {bot.recallBotId}</span>
                              <span className="pill">Status: {bot.status}</span>
                              <span className="pill">{formatTime(bot.createdAt)}</span>
                            </div>
                            <p className="code">
                              Last status checked:{" "}
                              {bot.lastStatusCheckedAt
                                ? formatTime(bot.lastStatusCheckedAt)
                                : "Never"}
                            </p>
                            <p className="code">
                              Joined at:{" "}
                              {bot.joinedAt ? formatTime(bot.joinedAt) : "Not set"}
                            </p>
                            <p className="code">Meeting URL: {bot.meetingUrl}</p>
                            {bot.lastErrorMessage ? (
                              <p className="code error-text">
                                Error: {bot.lastErrorMessage}
                              </p>
                            ) : null}
                            {bot.lastStopAttempt ? (
                              <details>
                                <summary>View last stop attempt</summary>
                                <div className="code-block">
                                  <p className="code">
                                    Attempted at: {formatTime(bot.lastStopAttempt.attemptedAt)}
                                  </p>
                                  <p className="code">
                                    Endpoint: {bot.lastStopAttempt.endpoint}
                                  </p>
                                  <p className="code">
                                    HTTP status:{" "}
                                    {bot.lastStopAttempt.httpStatus ?? "(unknown)"}
                                  </p>
                                  <p className="code">
                                    Error:{" "}
                                    {bot.lastStopAttempt.errorMessage ?? "(none)"}
                                  </p>
                                </div>
                                <pre className="code raw-json">
                                  {JSON.stringify(
                                    bot.lastStopAttempt.recallResponseBody,
                                    null,
                                    2,
                                  )}
                                </pre>
                              </details>
                            ) : null}
                            <div className="actions">
                              <button
                                className="button secondary"
                                type="button"
                                disabled={botActionBotId === bot.recallBotId}
                                onClick={() =>
                                  void handleRefreshBotStatus(bot.recallBotId)
                                }
                              >
                                {botActionBotId === bot.recallBotId
                                  ? "Working..."
                                  : "Refresh Status"}
                              </button>
                              <button
                                className="button secondary"
                                type="button"
                                disabled={botActionBotId === bot.recallBotId}
                                onClick={() => void handleStopBot(bot.recallBotId)}
                              >
                                {botActionBotId === bot.recallBotId
                                  ? "Working..."
                                  : "Stop Bot"}
                              </button>
                            </div>
                            <details>
                              <summary>View saved create-bot payload</summary>
                              <pre className="code raw-json">
                                {JSON.stringify(bot.createRequestPayload, null, 2)}
                              </pre>
                            </details>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                ) : (
                  <section className="result-block">
                    <div className="section-row">
                      <div>
                        <h4>Ended / History Bots</h4>
                      </div>
                      <div className="actions">
                        <button
                          className="button secondary"
                          type="button"
                          disabled={clearingHistoryBots || historyBots.length === 0}
                          onClick={() => void handleClearBotHistory()}
                        >
                          {clearingHistoryBots ? "Working..." : "Clear Bot History"}
                        </button>
                      </div>
                    </div>
                    {historyBots.length === 0 ? (
                      <div className="empty">No history bots match the current filters.</div>
                    ) : (
                      <div className="log-list">
                        {historyBots.map((bot) => (
                          <article className="log-item" key={bot.id}>
                            <h3>{bot.botName}</h3>
                            <div className="log-meta">
                              <span className="pill">Bot ID: {bot.recallBotId}</span>
                              <span className="pill">Status: {bot.status}</span>
                              <span className="pill">{formatTime(bot.createdAt)}</span>
                            </div>
                            <p className="code">
                              Last status checked:{" "}
                              {bot.lastStatusCheckedAt
                                ? formatTime(bot.lastStatusCheckedAt)
                                : "Never"}
                            </p>
                            <p className="code">
                              Joined at:{" "}
                              {bot.joinedAt ? formatTime(bot.joinedAt) : "Not set"}
                            </p>
                            <p className="code">Meeting URL: {bot.meetingUrl}</p>
                            {bot.lastErrorMessage ? (
                              <p className="code error-text">
                                Error: {bot.lastErrorMessage}
                              </p>
                            ) : null}
                            {bot.lastStopAttempt ? (
                              <details>
                                <summary>View last stop attempt</summary>
                                <div className="code-block">
                                  <p className="code">
                                    Attempted at: {formatTime(bot.lastStopAttempt.attemptedAt)}
                                  </p>
                                  <p className="code">
                                    Endpoint: {bot.lastStopAttempt.endpoint}
                                  </p>
                                  <p className="code">
                                    HTTP status:{" "}
                                    {bot.lastStopAttempt.httpStatus ?? "(unknown)"}
                                  </p>
                                  <p className="code">
                                    Error:{" "}
                                    {bot.lastStopAttempt.errorMessage ?? "(none)"}
                                  </p>
                                </div>
                                <pre className="code raw-json">
                                  {JSON.stringify(
                                    bot.lastStopAttempt.recallResponseBody,
                                    null,
                                    2,
                                  )}
                                </pre>
                              </details>
                            ) : null}
                            <div className="actions">
                              <button
                                className="button secondary"
                                type="button"
                                disabled={botActionBotId === bot.recallBotId}
                                onClick={() =>
                                  void handleRefreshBotStatus(bot.recallBotId)
                                }
                              >
                                {botActionBotId === bot.recallBotId
                                  ? "Working..."
                                  : "Refresh Status"}
                              </button>
                              <button
                                className="button secondary"
                                type="button"
                                disabled={deletingHistoryBotId === bot.id}
                                onClick={() => void handleDeleteHistoryBot(bot.id)}
                              >
                                {deletingHistoryBotId === bot.id
                                  ? "Working..."
                                  : "Delete"}
                              </button>
                            </div>
                            <details>
                              <summary>View saved create-bot payload</summary>
                              <pre className="code raw-json">
                                {JSON.stringify(bot.createRequestPayload, null, 2)}
                              </pre>
                            </details>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
