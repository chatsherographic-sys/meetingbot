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
import type { WebhookDebugLog } from "@/lib/types";

export function WebhooksPageClient() {
  const { currentSession, currentSessionId, loading: sessionLoading } =
    useMeetingSession();
  const [logs, setLogs] = useState<WebhookDebugLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [expandedWebhookLogIds, setExpandedWebhookLogIds] = useState<string[]>(
    [],
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [botIdSearch, setBotIdSearch] = useState("");
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
  });

  function toggleWebhookPayload(logId: string) {
    setExpandedWebhookLogIds((current) =>
      current.includes(logId)
        ? current.filter((item) => item !== logId)
        : [...current, logId],
    );
  }

  async function loadWebhookLogs() {
    const response = await fetch(
      `/api/logs/webhook-debug${buildQueryString({
        page,
        pageSize,
        sessionId: currentSessionId,
        botId: botIdSearch,
        search: transcriptSearch,
        event: eventFilter,
        status: statusFilter,
      })}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error("Failed to load webhook debug logs.");
    }

    const payload = await readJsonResponse<{
      webhookDebugLogs: WebhookDebugLog[];
      pagination: ListPagination;
    }>(response);

    setLogs(payload.webhookDebugLogs);
    setPagination(payload.pagination);
    setError(null);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        await loadWebhookLogs();
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load webhook debug logs.",
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

      void loadWebhookLogs().catch(() => {
        // The next polling cycle can recover without interrupting the page.
      });
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [page, pageSize, botIdSearch, transcriptSearch, eventFilter, statusFilter, currentSessionId]);

  async function clearWebhookDebugLogs() {
    setMessage(null);

    try {
      const response = await fetch(
        `/api/logs/webhook-debug?sessionId=${encodeURIComponent(currentSessionId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to clear webhook debug logs.");
      }

      setMessage({
        type: "success",
        text: "Webhook debug logs cleared.",
      });
      await loadWebhookLogs();
    } catch (clearError) {
      setMessage({
        type: "error",
        text:
          clearError instanceof Error
            ? clearError.message
            : "Failed to clear webhook debug logs.",
      });
    }
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Webhooks</p>
          <h2>Webhook debug logs</h2>
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
              <h3>Webhook Debug Logs</h3>
              <p>Newest first. Raw payloads stay collapsed until expanded.</p>
            </div>
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void loadWebhookLogs()}
              >
                Refresh data
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => void clearWebhookDebugLogs()}
              >
                Clear all webhook debug logs
              </button>
            </div>
          </div>
        </div>
        <div className="card-body">
          <div className="filters-grid">
            <div className="field">
              <label htmlFor="webhook-bot-id-search">Search bot ID</label>
              <input
                id="webhook-bot-id-search"
                value={botIdSearch}
                onChange={(event) => {
                  setBotIdSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="fake-bot-id"
              />
            </div>
            <div className="field">
              <label htmlFor="webhook-transcript-search">
                Search transcript text
              </label>
              <input
                id="webhook-transcript-search"
                value={transcriptSearch}
                onChange={(event) => {
                  setTranscriptSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="trigger phrase"
              />
            </div>
            <div className="field">
              <label htmlFor="webhook-event-filter">Filter event</label>
              <select
                id="webhook-event-filter"
                value={eventFilter}
                onChange={(event) => {
                  setEventFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All events</option>
                <option value="transcript.data">transcript.data</option>
                <option value="transcript.partial_data">
                  transcript.partial_data
                </option>
                <option value="transcript.failed">transcript.failed</option>
                <option value="transcript.done">transcript.done</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="webhook-status-filter">Filter status</label>
              <select
                id="webhook-status-filter"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                <option value="processed">processed</option>
                <option value="ignored">ignored</option>
                <option value="failed">failed</option>
                <option value="unknown">unknown</option>
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
            <div className="empty">Loading webhook debug logs...</div>
          ) : logs.length === 0 ? (
            <div className="empty">No webhook debug logs yet.</div>
          ) : (
            <div className="log-list">
              {logs.map((log) => {
                const isExpanded = expandedWebhookLogIds.includes(log.id);

                return (
                  <article className="log-item" key={log.id}>
                    <h3>{log.eventName}</h3>
                    <div className="log-meta">
                      <span className={`pill status-${log.status}`}>
                        Status: {log.status}
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
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => toggleWebhookPayload(log.id)}
                    >
                      {isExpanded ? "Hide raw payload" : "View raw payload"}
                    </button>
                    {isExpanded ? (
                      <pre className="code raw-json">
                        {JSON.stringify(log.rawPayload, null, 2)}
                      </pre>
                    ) : null}
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
