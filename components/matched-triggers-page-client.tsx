"use client";

import { useEffect, useState } from "react";
import {
  buildQueryString,
  formatTime,
  isDocumentVisible,
  type ListPagination,
  readJsonResponse,
  type PanelMessage,
} from "@/components/control-panel-client";
import { useMeetingSession } from "@/components/meeting-session-context";
import { PaginationControls } from "@/components/pagination-controls";
import type { MatchLog } from "@/lib/types";

function isUserVisibleSenderStatus(status: MatchLog["senderResults"][number]["status"]) {
  return (
    status === "dry_run" ||
    status === "sent" ||
    status === "failed" ||
    status === "no_active_sender_bot"
  );
}

export function MatchedTriggersPageClient() {
  const { currentSession, currentSessionId, loading: sessionLoading } =
    useMeetingSession();
  const [logs, setLogs] = useState<MatchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [botIdSearch, setBotIdSearch] = useState("");
  const [triggerSearch, setTriggerSearch] = useState("");
  const [replySearch, setReplySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
  });

  async function loadMatchedTriggerLogs() {
    const response = await fetch(
      `/api/logs/matched-trigger${buildQueryString({
        page,
        pageSize,
        sessionId: currentSessionId,
        botId: botIdSearch,
        triggerSearch,
        replySearch,
        status: statusFilter,
      })}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error("Failed to load matched trigger logs.");
    }

    const payload = await readJsonResponse<{
      matchLogs: MatchLog[];
      pagination: ListPagination;
    }>(response);

    setLogs(payload.matchLogs);
    setPagination(payload.pagination);
    setError(null);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        await loadMatchedTriggerLogs();
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load matched trigger logs.",
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

      void loadMatchedTriggerLogs().catch(() => {
        // The next polling cycle can recover without interrupting the page.
      });
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [page, pageSize, botIdSearch, triggerSearch, replySearch, statusFilter, currentSessionId]);

  async function clearMatchedTriggerLogs() {
    setMessage(null);

    try {
      const response = await fetch(
        `/api/logs/matched-trigger?sessionId=${encodeURIComponent(currentSessionId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to clear matched trigger logs.");
      }

      setMessage({
        type: "success",
        text: "Matched trigger logs cleared.",
      });
      await loadMatchedTriggerLogs();
    } catch (clearError) {
      setMessage({
        type: "error",
        text:
          clearError instanceof Error
            ? clearError.message
            : "Failed to clear matched trigger logs.",
      });
    }
  }

  async function deleteMatchedTriggerLog(logId: string) {
    setMessage(null);

    try {
      const response = await fetch(`/api/logs/matched-trigger/${logId}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete matched trigger log.");
      }

      setMessage({
        type: "success",
        text: "Matched trigger log deleted.",
      });
      await loadMatchedTriggerLogs();
    } catch (deleteError) {
      setMessage({
        type: "error",
        text:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete matched trigger log.",
      });
    }
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Matched Triggers</p>
          <h2>Matched trigger logs</h2>
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
      {message ? <p className={`message ${message.type}`}>{message.text}</p> : null}

      <section className="card">
        <div className="card-body">
          <div className="code-block">
            <p className="code">
              Current session: {currentSession?.name ?? "(not selected)"}
            </p>
            <p className="code">
              Current session status: {currentSession?.status ?? "(unknown)"}
            </p>
            <p className="code">
              Current session Zoom URL: {currentSession?.zoomUrl || "(empty)"}
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div className="section-row">
            <div>
              <h3>Matched Trigger Logs</h3>
              <p>Historical trigger records remain read-only.</p>
            </div>
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void loadMatchedTriggerLogs()}
              >
                Refresh data
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => void clearMatchedTriggerLogs()}
              >
                Clear all matched trigger logs
              </button>
            </div>
          </div>
        </div>
        <div className="card-body">
          <div className="filters-grid">
            <div className="field">
              <label htmlFor="matched-trigger-search">Search trigger phrase</label>
              <input
                id="matched-trigger-search"
                value={triggerSearch}
                onChange={(event) => {
                  setTriggerSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="trigger phrase"
              />
            </div>
            <div className="field">
              <label htmlFor="matched-reply-search">Search reply message</label>
              <input
                id="matched-reply-search"
                value={replySearch}
                onChange={(event) => {
                  setReplySearch(event.target.value);
                  setPage(1);
                }}
                placeholder="reply message"
              />
            </div>
            <div className="field">
              <label htmlFor="matched-bot-id-search">
                Search source or sender bot ID
              </label>
              <input
                id="matched-bot-id-search"
                value={botIdSearch}
                onChange={(event) => {
                  setBotIdSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="fake-bot-id"
              />
            </div>
            <div className="field">
              <label htmlFor="matched-status-filter">Filter status</label>
              <select
                id="matched-status-filter"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                <option value="dry_run">dry_run</option>
                <option value="sent">sent</option>
                <option value="failed">failed</option>
                <option value="no_active_sender_bot">no_active_sender_bot</option>
              </select>
            </div>
          </div>
          <PaginationControls
            pagination={pagination}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />
          {loading ? (
            <div className="empty">Loading matched trigger logs...</div>
          ) : logs.length === 0 ? (
            <div className="empty">No matched triggers yet.</div>
          ) : (
            <div className="log-list">
              {logs.map((log) => {
                const visibleSenderResults = log.senderResults.filter((senderResult) =>
                  isUserVisibleSenderStatus(senderResult.status),
                );
                const hiddenInternalResults = log.senderResults.filter(
                  (senderResult) => !isUserVisibleSenderStatus(senderResult.status),
                );

                return (
                  <article className="log-item" key={log.id}>
                    <h3>{log.triggerPhrase}</h3>
                    <p className="code">{log.replyMessage}</p>
                    <div className="log-meta">
                      <span className={`pill status-${log.status}`}>
                        Status: {log.status}
                      </span>
                      <span className="pill">
                        Execution ID: {log.triggerExecutionId ?? "None"}
                      </span>
                      <span className="pill">Source event: {log.sourceEvent}</span>
                      <span className="pill">Match type: {log.matchType}</span>
                      <span className="pill">
                        Source webhook bot: {log.sourceWebhookBotId ?? "Unknown"}
                      </span>
                      <span className="pill">Sender mode: {log.senderMode}</span>
                      {log.senderMode === "round_robin_bots" ? (
                        <>
                          <span className="pill">
                            Previous round-robin index:{" "}
                            {log.previousRoundRobinIndex ?? "None"}
                          </span>
                          <span className="pill">
                            Next round-robin index: {log.nextRoundRobinIndex ?? "None"}
                          </span>
                        </>
                      ) : null}
                      <span className="pill">
                        Delay: {log.responseDelaySeconds}s
                      </span>
                      <span className="pill">
                        Total:{" "}
                        {log.latencyDiagnostics?.totalProcessingMs !== null &&
                        log.latencyDiagnostics?.totalProcessingMs !== undefined
                          ? `${log.latencyDiagnostics.totalProcessingMs}ms`
                          : "n/a"}
                      </span>
                      <span className="pill">
                        Match:{" "}
                        {log.latencyDiagnostics?.triggerMatchMs !== null &&
                        log.latencyDiagnostics?.triggerMatchMs !== undefined
                          ? `${log.latencyDiagnostics.triggerMatchMs}ms`
                          : "n/a"}
                      </span>
                      <span className="pill">
                        Send:{" "}
                        {log.latencyDiagnostics?.sendChatMs !== null &&
                        log.latencyDiagnostics?.sendChatMs !== undefined
                          ? `${log.latencyDiagnostics.sendChatMs}ms`
                          : "n/a"}
                      </span>
                      <span className="pill">
                        Usage after trigger:{" "}
                        {log.triggerCountAfter ?? "n/a"} /{" "}
                        {log.maxTriggerCount ?? "unlimited"}
                      </span>
                      <span className="pill">{formatTime(log.createdAt)}</span>
                    </div>
                    {log.autoDisabledAfterTrigger ? (
                      <p className="message error">
                        This trigger rule auto-disabled after this match.
                      </p>
                    ) : null}
                    <p className="code">
                      Unique sender bot IDs used:{" "}
                      {log.senderBotIdsUsed.length > 0
                        ? log.senderBotIdsUsed.join(", ")
                        : "None"}
                    </p>
                    {log.senderMode === "round_robin_bots" ? (
                      <p className="code">Sender pool: all active bots</p>
                    ) : null}
                    <p className="code">
                      Original sender bot IDs:{" "}
                      {log.originalSenderBotIds.length > 0
                        ? log.originalSenderBotIds.join(", ")
                        : "None"}
                    </p>
                    <p className="code">
                      Deduped sender bot IDs:{" "}
                      {log.dedupedSenderBotIds.length > 0
                        ? log.dedupedSenderBotIds.join(", ")
                        : "None"}
                    </p>
                    <p className="code">
                      Send attempts: {log.sendAttemptCount} | Actual sends:{" "}
                      {log.actualSendCount}
                    </p>
                    {log.senderMode === "round_robin_bots" ? (
                      <p className="code">
                        Chosen round-robin bot:{" "}
                        {log.chosenRoundRobinBotName && log.chosenRoundRobinBotId
                          ? `${log.chosenRoundRobinBotName} (${log.chosenRoundRobinBotId})`
                          : "None"}
                      </p>
                    ) : null}
                    {hiddenInternalResults.length > 0 ? (
                      <p className="code">
                        Internal duplicate-send protection skipped{" "}
                        {hiddenInternalResults.length} sender attempt(s).
                      </p>
                    ) : null}
                    {log.warningMessages.length > 0 ? (
                      <div className="warning-list">
                        {log.warningMessages.map((warningMessage) => (
                          <p className="message error" key={`${log.id}-${warningMessage}`}>
                            {warningMessage}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    <p className="code">{log.transcriptText}</p>
                    <div className="result-stack">
                      <div className="result-block">
                        <h4>Per-bot results</h4>
                        <div className="log-list compact-list">
                          {visibleSenderResults.map((senderResult, index) => (
                            <article
                              className="log-item"
                              key={`${log.id}-${senderResult.senderBotId ?? index}`}
                            >
                              <h3>
                                {senderResult.senderBotName ??
                                  senderResult.senderBotId ??
                                  "Unknown sender bot"}
                              </h3>
                              <div className="log-meta">
                                <span className={`pill status-${senderResult.status}`}>
                                  {senderResult.status}
                                </span>
                                <span className="pill">
                                  Sender bot ID: {senderResult.senderBotId ?? "Unknown"}
                                </span>
                              </div>
                              <p className="code">{senderResult.action}</p>
                              {senderResult.errorMessage ? (
                                <p className="code error-text">
                                  Error: {senderResult.errorMessage}
                                </p>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      </div>
                    </div>
                    {log.errorMessage ? (
                      <p className="code error-text">Error: {log.errorMessage}</p>
                    ) : null}
                    <div className="actions">
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => void deleteMatchedTriggerLog(log.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
