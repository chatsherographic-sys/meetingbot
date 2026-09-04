"use client";

import { useEffect, useState } from "react";
import { formatTime, readJsonResponse, type PanelMessage } from "@/components/control-panel-client";
import { useMeetingSession } from "@/components/meeting-session-context";
import type { ErrorLog } from "@/lib/types";

export function ErrorLogsPageClient() {
  const { currentSessionId } = useMeetingSession();
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<PanelMessage>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function loadLogs() {
    const response = await fetch(`/api/error-logs?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=100`, { cache: "no-store" });
    const payload = await readJsonResponse<{ error?: string; errorLogs?: ErrorLog[] }>(response);
    if (!response.ok) throw new Error(payload.error ?? "Failed to load error logs.");
    setLogs(payload.errorLogs ?? []);
  }

  useEffect(() => { void loadLogs().catch((error) => setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load error logs." })); }, [currentSessionId]);

  async function remove(id?: string) {
    if (!password) {
      setMessage({ type: "error", text: "Enter the delete password first." });
      return;
    }
    if (!id && !window.confirm("Delete all error logs for the current session?")) return;
    setWorkingId(id ?? "all");
    try {
      const response = await fetch("/api/error-logs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, id, sessionId: currentSessionId, clearAll: !id }) });
      const payload = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Failed to delete error log.");
      setMessage({ type: "success", text: id ? "Error log deleted." : "Error logs cleared." });
      await loadLogs();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to delete error log." }); }
    finally { setWorkingId(null); }
  }

  return <div className="page-stack"><section className="page-header"><div><p className="section-kicker">Error Logs</p><h2>Server error history</h2><p className="muted">Only errors for the current sidebar session are shown.</p></div></section>{message ? <p className={`message ${message.type}`}>{message.text}</p> : null}<section className="card"><div className="card-body"><div className="filters-grid"><div className="field"><label htmlFor="error-log-password">Delete password</label><input id="error-log-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Required for delete" /></div><div className="actions"><button className="button secondary" type="button" disabled={workingId === "all" || logs.length === 0} onClick={() => void remove()}>{workingId === "all" ? "Deleting..." : "Clear All Error Logs"}</button></div></div><div className="log-list">{logs.length === 0 ? <div className="empty">No error logs for this session.</div> : logs.map((log) => <article className="log-item" key={log.id}><h3>{log.source}</h3><p className="code error-text">{log.message}</p><div className="log-meta"><span className="pill">{formatTime(log.createdAt)}</span></div><div className="actions"><button className="button secondary" type="button" disabled={workingId === log.id} onClick={() => void remove(log.id)}>{workingId === log.id ? "Deleting..." : "Delete"}</button></div></article>)}</div></div></section></div>;
}
