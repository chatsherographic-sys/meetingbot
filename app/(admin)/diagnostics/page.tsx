import { unstable_noStore as noStore } from "next/cache";
import {
  getRecallWebhookUrl,
  isVercelAutomationBypassConfigured,
} from "@/lib/recall";
import { getLogs, getStorageHealth } from "@/lib/store";
import { getStorageDriver } from "@/lib/storage/config";

function formatBooleanLabel(value: boolean): string {
  return value ? "Yes" : "No";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

export default async function DiagnosticsPage() {
  noStore();

  const storageDriver = getStorageDriver();
  const recallRegion = process.env.RECALL_REGION?.trim() || "(not set)";
  const sendChatEnabled =
    process.env.RECALL_SEND_CHAT_ENABLED?.trim().toLowerCase() === "true";
  const publicWebhookBaseUrl =
    process.env.PUBLIC_WEBHOOK_BASE_URL?.trim() || "http://localhost:3000";
  const recallApiKeyConfigured = Boolean(process.env.RECALL_API_KEY?.trim());
  const vercelAutomationBypassConfigured = isVercelAutomationBypassConfigured();
  const isProductionRuntime =
    process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const usesLocalhostWebhookBaseUrl =
    /localhost|127\.0\.0\.1|::1/i.test(publicWebhookBaseUrl);
  const diagnosticsWarnings: string[] = [];

  if (isProductionRuntime && storageDriver === "local") {
    diagnosticsWarnings.push(
      "STORAGE_DRIVER=local is not recommended in production or on Vercel. Use STORAGE_DRIVER=supabase instead.",
    );
  }

  if (usesLocalhostWebhookBaseUrl) {
    diagnosticsWarnings.push(
      "PUBLIC_WEBHOOK_BASE_URL points to localhost, so Recall cannot deliver real internet webhook traffic to this app.",
    );
  }

  if (sendChatEnabled) {
    diagnosticsWarnings.push(
      "RECALL_SEND_CHAT_ENABLED=true is active. Real Zoom chat messages can be sent from this deployment.",
    );
  }

  let storageHealth;

  try {
    storageHealth = await getStorageHealth();
  } catch (error) {
    storageHealth = {
      storageDriver,
      ok: false,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown storage health error",
    };
  }

  let logsError: string | null = null;
  let logs: Awaited<ReturnType<typeof getLogs>> = {
    transcriptLogs: [],
    matchLogs: [],
    webhookDebugLogs: [],
  };

  try {
    logs = await getLogs();
  } catch (error) {
    logsError =
      error instanceof Error
        ? error.message
        : "Unable to read logs from storage.";
  }

  const latestWebhookLogs = logs.webhookDebugLogs.slice(0, 10);
  const latestTranscriptLogs = logs.transcriptLogs.slice(0, 10);
  const latestTranscriptLifecycleEvents = logs.webhookDebugLogs
    .filter(
      (log) =>
        log.eventName === "transcript.failed" || log.eventName === "transcript.done",
    )
    .slice(0, 10);

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Diagnostics</p>
          <h2>Transcript troubleshooting</h2>
          <p className="muted">
            Compare Recall bot configuration, webhook delivery evidence, and
            extracted transcript logs before changing trigger behavior.
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3>Environment Snapshot</h3>
          <p>These values are read on the server for the current request.</p>
        </div>
        <div className="card-body">
          <div className="settings-list">
            <div className="setting-item">
              <span className="setting-label">STORAGE_DRIVER</span>
              <span className="setting-value">{storageDriver}</span>
            </div>
            <div className="setting-item">
              <span className="setting-label">Storage Health</span>
              <span className="setting-value">
                {storageHealth.ok ? "ok" : "failed"}
              </span>
            </div>
            <div className="setting-item">
              <span className="setting-label">Storage last checked</span>
              <span className="setting-value">
                {formatTime(storageHealth.checkedAt)}
              </span>
            </div>
            <div className="setting-item">
              <span className="setting-label">PUBLIC_WEBHOOK_BASE_URL</span>
              <span className="setting-value">{publicWebhookBaseUrl}</span>
            </div>
            <div className="setting-item">
              <span className="setting-label">Full webhook URL</span>
              <span className="setting-value">{getRecallWebhookUrl()}</span>
            </div>
            <div className="setting-item">
              <span className="setting-label">RECALL_REGION</span>
              <span className="setting-value">{recallRegion}</span>
            </div>
            <div className="setting-item">
              <span className="setting-label">RECALL_SEND_CHAT_ENABLED</span>
              <span className="setting-value">
                {sendChatEnabled ? "true" : "false"}
              </span>
            </div>
            <div className="setting-item">
              <span className="setting-label">Recall API key configured</span>
              <span className="setting-value">
                {formatBooleanLabel(recallApiKeyConfigured)}
              </span>
            </div>
            <div className="setting-item">
              <span className="setting-label">
                VERCEL_AUTOMATION_BYPASS_SECRET configured
              </span>
              <span className="setting-value">
                {formatBooleanLabel(vercelAutomationBypassConfigured)}
              </span>
            </div>
          </div>
          {!storageHealth.ok && storageHealth.error ? (
            <p className="message error">Storage error: {storageHealth.error}</p>
          ) : null}
          {logsError ? (
            <p className="message error">Log read error: {logsError}</p>
          ) : null}
          {diagnosticsWarnings.length > 0 ? (
            <div className="message warning">
              {diagnosticsWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3>Last 10 Webhook Debug Logs</h3>
          <p>Use this to confirm Recall is reaching your webhook URL.</p>
        </div>
        <div className="card-body">
          {latestWebhookLogs.length === 0 ? (
            <div className="empty">No webhook debug logs yet.</div>
          ) : (
            <div className="log-list compact-list">
              {latestWebhookLogs.map((log) => (
                <article className="log-item" key={log.id}>
                  <h3>{log.eventName}</h3>
                  <div className="log-meta">
                    <span className={`pill status-${log.status}`}>
                      Status: {log.status}
                    </span>
                    <span className="pill">Bot: {log.botId ?? "Unknown"}</span>
                    <span className="pill">{formatTime(log.receivedAt)}</span>
                  </div>
                  <p className="code">
                    Transcript: {log.extractedTranscriptText ?? "(none)"}
                  </p>
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
          <h3>Last 10 Transcript Logs</h3>
          <p>Use this to confirm the app extracted transcript text correctly.</p>
        </div>
        <div className="card-body">
          {latestTranscriptLogs.length === 0 ? (
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
                  <p className="code">{log.transcriptText || "(empty transcript)"}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3>Last 10 transcript.failed / transcript.done Events</h3>
          <p>
            Use these lifecycle events to check whether transcription finished
            or failed before the app tried to match trigger rules.
          </p>
        </div>
        <div className="card-body">
          {latestTranscriptLifecycleEvents.length === 0 ? (
            <div className="empty">
              No transcript.failed or transcript.done webhook events yet.
            </div>
          ) : (
            <div className="log-list compact-list">
              {latestTranscriptLifecycleEvents.map((log) => (
                <article className="log-item" key={log.id}>
                  <h3>{log.eventName}</h3>
                  <div className="log-meta">
                    <span className={`pill status-${log.status}`}>
                      Status: {log.status}
                    </span>
                    <span className="pill">Bot: {log.botId ?? "Unknown"}</span>
                    <span className="pill">{formatTime(log.receivedAt)}</span>
                  </div>
                  {log.errorMessage ? (
                    <p className="code error-text">Error: {log.errorMessage}</p>
                  ) : (
                    <p className="code">
                      Transcript snippet: {log.extractedTranscriptText ?? "(none)"}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
