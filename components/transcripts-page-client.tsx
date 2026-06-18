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
import type { TranscriptLog } from "@/lib/types";

export function TranscriptsPageClient() {
  const { currentSession, currentSessionId, loading: sessionLoading } =
    useMeetingSession();
  const [logs, setLogs] = useState<TranscriptLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [botIdSearch, setBotIdSearch] = useState("");
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
  });

  async function loadTranscriptLogs() {
    const response = await fetch(
      `/api/logs/transcript${buildQueryString({
        page,
        pageSize,
        sessionId: currentSessionId,
        botId: botIdSearch,
        search: transcriptSearch,
      })}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error("Failed to load transcript logs.");
    }

    const payload = await readJsonResponse<{
      transcriptLogs: TranscriptLog[];
      pagination: ListPagination;
    }>(response);

    setLogs(payload.transcriptLogs);
    setPagination(payload.pagination);
    setError(null);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        await loadTranscriptLogs();
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load transcript logs.",
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

      void loadTranscriptLogs().catch(() => {
        // The next polling cycle can recover without interrupting the page.
      });
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [page, pageSize, botIdSearch, transcriptSearch, currentSessionId]);

  async function clearTranscriptLogs() {
    setMessage(null);

    try {
      const response = await fetch(
        `/api/logs/transcript?sessionId=${encodeURIComponent(currentSessionId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to clear transcript logs.");
      }

      setMessage({
        type: "success",
        text: "Transcript logs cleared.",
      });
      await loadTranscriptLogs();
    } catch (clearError) {
      setMessage({
        type: "error",
        text:
          clearError instanceof Error
            ? clearError.message
            : "Failed to clear transcript logs.",
      });
    }
  }

  async function deleteTranscriptLog(logId: string) {
    setMessage(null);

    try {
      const response = await fetch(`/api/logs/transcript/${logId}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete transcript log.");
      }

      setMessage({
        type: "success",
        text: "Transcript log deleted.",
      });
      await loadTranscriptLogs();
    } catch (deleteError) {
      setMessage({
        type: "error",
        text:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete transcript log.",
      });
    }
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Transcripts</p>
          <h2>Transcript logs</h2>
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
              <h3>Transcript Logs</h3>
              <p>
                Historical transcript records remain read-only. Transcript logs
                are batched to keep live triggers fast.
              </p>
            </div>
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void loadTranscriptLogs()}
              >
                Refresh data
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => void clearTranscriptLogs()}
              >
                Clear all transcript logs
              </button>
            </div>
          </div>
        </div>
        <div className="card-body">
          <div className="filters-grid filters-grid--compact">
            <div className="field">
              <label htmlFor="transcript-search">Search transcript text</label>
              <input
                id="transcript-search"
                value={transcriptSearch}
                onChange={(event) => {
                  setTranscriptSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="matched phrase"
              />
            </div>
            <div className="field">
              <label htmlFor="transcript-bot-id-search">Search bot ID</label>
              <input
                id="transcript-bot-id-search"
                value={botIdSearch}
                onChange={(event) => {
                  setBotIdSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="fake-bot-id"
              />
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
            <div className="empty">Loading transcript logs...</div>
          ) : logs.length === 0 ? (
            <div className="empty">No transcript logs yet.</div>
          ) : (
            <div className="log-list">
              {logs.map((log) => (
                <article className="log-item" key={log.id}>
                  <h3>{formatTime(log.createdAt)}</h3>
                  <div className="log-meta">
                    <span className="pill">Bot: {log.botId ?? "Unknown"}</span>
                    <span className="pill">Event: {log.sourceEvent}</span>
                    <span className="pill">
                      Matched rules: {log.matchedRuleIds.length}
                    </span>
                  </div>
                  <p className="code">{log.transcriptText || "(empty transcript)"}</p>
                  <p className="muted code">
                    Normalized: {log.normalizedTranscriptText || "(empty)"}
                  </p>
                  <div className="actions">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => void deleteTranscriptLog(log.id)}
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
  );
}
