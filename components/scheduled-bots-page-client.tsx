"use client";

import {
  Dispatch,
  FormEvent,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  formatTime,
  readJsonResponse,
  type PanelMessage,
} from "@/components/control-panel-client";
import { useMeetingSession } from "@/components/meeting-session-context";
import { getSessionOperationBlockedMessage } from "@/lib/session-operations";
import { FIXED_TRANSCRIPT_LANGUAGE_LABEL } from "@/lib/transcript-language";
import type { ScheduledBotJoin } from "@/lib/types";

type ScheduledBotJoinFormState = {
  sessionId: string;
  name: string;
  scheduledDate: string;
  scheduledTime: string;
  botCount: string;
  botNames: string[];
  transcriptLanguage: string;
  enabled: boolean;
};

type RunDueScheduledBotsResult = {
  checkedAt: string;
  processedCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  scheduledBotJoins: ScheduledBotJoin[];
} | null;

const DEFAULT_BOT_COUNT = "1";
const DEFAULT_TRANSCRIPT_LANGUAGE = "zh-CN";

function createDefaultScheduleFormState(sessionId: string): ScheduledBotJoinFormState {
  return {
    sessionId,
    name: "",
    scheduledDate: "",
    scheduledTime: "",
    botCount: DEFAULT_BOT_COUNT,
    botNames: ["Bot 1"],
    transcriptLanguage: DEFAULT_TRANSCRIPT_LANGUAGE,
    enabled: true,
  };
}

function buildDefaultBotNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Bot ${index + 1}`);
}

function splitScheduledAt(value: string): {
  scheduledDate: string;
  scheduledTime: string;
} {
  if (!value) {
    return {
      scheduledDate: "",
      scheduledTime: "",
    };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      scheduledDate: "",
      scheduledTime: "",
    };
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return {
    scheduledDate: `${year}-${month}-${day}`,
    scheduledTime: `${hours}:${minutes}`,
  };
}

function combineScheduledAt(date: string, time: string): string {
  if (!date || !time) {
    throw new Error("Scheduled date and time are required.");
  }

  const combined = new Date(`${date}T${time}`);

  if (Number.isNaN(combined.getTime())) {
    throw new Error("Scheduled date and time are invalid.");
  }

  return combined.toISOString();
}

type ScheduledBotsPageClientProps = {
  preflightErrors: string[];
  preflightWarnings: string[];
};

export function ScheduledBotsPageClient({
  preflightErrors,
  preflightWarnings,
}: ScheduledBotsPageClientProps) {
  const { currentSession, currentSessionId, meetingSessions, loading: sessionLoading } =
    useMeetingSession();
  const [scheduledBotJoins, setScheduledBotJoins] = useState<ScheduledBotJoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [lastAutoRunTime, setLastAutoRunTime] = useState<string | null>(null);
  const [lastAutoRunResult, setLastAutoRunResult] =
    useState<RunDueScheduledBotsResult>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduledBotJoinFormState>(
    createDefaultScheduleFormState(currentSessionId),
  );
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingScheduleForm, setEditingScheduleForm] =
    useState<ScheduledBotJoinFormState>(
      createDefaultScheduleFormState(currentSessionId),
    );
  const isRunDueInFlightRef = useRef(false);

  const hasCurrentSession = Boolean(currentSession);
  const currentSessionHasZoomUrl = Boolean(currentSession?.zoomUrl.trim());
  const currentSessionBlockedMessage = getSessionOperationBlockedMessage(
    currentSession?.status,
  );

  useEffect(() => {
    setScheduleForm((current) => ({
      ...current,
      sessionId: currentSessionId,
    }));
    setEditingScheduleId(null);
  }, [currentSessionId]);

  useEffect(() => {
    const parsedCount = Math.min(
      20,
      Math.max(1, Math.floor(Number(scheduleForm.botCount) || 1)),
    );
    const nextDefaultNames = buildDefaultBotNames(parsedCount);

    setScheduleForm((current) => ({
      ...current,
      botNames: Array.from({ length: parsedCount }, (_, index) => {
        const currentBotName = current.botNames[index];

        if (!currentBotName) {
          return nextDefaultNames[index];
        }

        return currentBotName;
      }),
    }));
  }, [scheduleForm.botCount]);

  useEffect(() => {
    const parsedCount = Math.min(
      20,
      Math.max(1, Math.floor(Number(editingScheduleForm.botCount) || 1)),
    );
    const nextDefaultNames = buildDefaultBotNames(parsedCount);

    setEditingScheduleForm((current) => ({
      ...current,
      botNames: Array.from({ length: parsedCount }, (_, index) => {
        const currentBotName = current.botNames[index];

        if (!currentBotName) {
          return nextDefaultNames[index];
        }

        return currentBotName;
      }),
    }));
  }, [editingScheduleForm.botCount]);

  async function loadScheduledBotJoins() {
    const response = await fetch(
      `/api/scheduled-bots?pageSize=200&sessionId=${encodeURIComponent(currentSessionId)}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error("Failed to load scheduled bot joins.");
    }

    const payload = await readJsonResponse<{
      scheduledBotJoins: ScheduledBotJoin[];
    }>(response);
    setScheduledBotJoins(payload.scheduledBotJoins);
    setError(null);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        await loadScheduledBotJoins();
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load scheduled bot joins.",
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

  async function performRunDueScheduledBots() {
    if (isRunDueInFlightRef.current) {
      return;
    }

    isRunDueInFlightRef.current = true;

    try {
      const response = await fetch("/api/scheduled-bots/run-due", {
        method: "POST",
      });
      const payload = await readJsonResponse<
        RunDueScheduledBotsResult & {
          error?: string;
        }
      >(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to run due scheduled bot joins.");
      }

      setLastAutoRunTime(new Date().toISOString());
      setLastAutoRunResult({
        checkedAt: payload.checkedAt,
        processedCount: payload.processedCount,
        completedCount: payload.completedCount,
        failedCount: payload.failedCount,
        skippedCount: payload.skippedCount,
        scheduledBotJoins: payload.scheduledBotJoins,
      });
      await loadScheduledBotJoins();
    } catch (runError) {
      setLastAutoRunTime(new Date().toISOString());
      setLastAutoRunResult(null);
      setMessage({
        type: "error",
        text:
          runError instanceof Error
            ? `Scheduled bot auto-run failed: ${runError.message}`
            : "Scheduled bot auto-run failed.",
      });
    } finally {
      isRunDueInFlightRef.current = false;
    }
  }

  useEffect(() => {
    const interval = window.setInterval(() => {
      void performRunDueScheduledBots();
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  async function handleCreateScheduledBotJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      if (!currentSessionId) {
        throw new Error("Please select a session from the navigation bar first.");
      }

      if (!hasCurrentSession) {
        throw new Error("Please select a session from the navigation bar first.");
      }

      if (currentSessionBlockedMessage) {
        throw new Error(currentSessionBlockedMessage);
      }

      if (!currentSessionHasZoomUrl) {
        throw new Error(
          "Current session has no Zoom URL. Please add Zoom URL before scheduling bots.",
        );
      }

      const response = await fetch("/api/scheduled-bots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: currentSessionId,
          name: scheduleForm.name,
          scheduledAt: combineScheduledAt(
            scheduleForm.scheduledDate,
            scheduleForm.scheduledTime,
          ),
          botCount: Number(scheduleForm.botCount),
          botNames: scheduleForm.botNames,
          transcriptLanguage: scheduleForm.transcriptLanguage,
          enabled: scheduleForm.enabled,
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create scheduled bot join.");
      }

      setScheduleForm(createDefaultScheduleFormState(currentSessionId));
      setMessage({
        type: "success",
        text: "Scheduled bot join created.",
      });
      await loadScheduledBotJoins();
    } catch (createError) {
      setMessage({
        type: "error",
        text:
          createError instanceof Error
            ? createError.message
            : "Failed to create scheduled bot join.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function startEditingSchedule(scheduledBotJoin: ScheduledBotJoin) {
    if (scheduledBotJoin.sessionId !== currentSessionId) {
      setMessage({
        type: "error",
        text: "This schedule belongs to another session. Switch to that session from the navigation bar first.",
      });
      return;
    }

    const { scheduledDate, scheduledTime } = splitScheduledAt(
      scheduledBotJoin.scheduledAt,
    );

    setEditingScheduleId(scheduledBotJoin.id);
    setEditingScheduleForm({
      sessionId: currentSessionId,
      name: scheduledBotJoin.name,
      scheduledDate,
      scheduledTime,
      botCount: String(scheduledBotJoin.botCount),
      botNames: scheduledBotJoin.botNames,
      transcriptLanguage: scheduledBotJoin.transcriptLanguage,
      enabled: scheduledBotJoin.enabled,
    });
    setMessage(null);
  }

  async function handleSaveScheduledBotJoin(scheduleId: string) {
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/scheduled-bots/${scheduleId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editingScheduleForm.name,
          scheduledAt: combineScheduledAt(
            editingScheduleForm.scheduledDate,
            editingScheduleForm.scheduledTime,
          ),
          botCount: Number(editingScheduleForm.botCount),
          botNames: editingScheduleForm.botNames,
          transcriptLanguage: editingScheduleForm.transcriptLanguage,
          enabled: editingScheduleForm.enabled,
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update scheduled bot join.");
      }

      setEditingScheduleId(null);
      setMessage({
        type: "success",
        text: "Scheduled bot join updated.",
      });
      await loadScheduledBotJoins();
    } catch (saveError) {
      setMessage({
        type: "error",
        text:
          saveError instanceof Error
            ? saveError.message
            : "Failed to update scheduled bot join.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleScheduledBotJoin(schedule: ScheduledBotJoin) {
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/scheduled-bots/${schedule.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: !schedule.enabled,
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update scheduled bot join.");
      }

      setMessage({
        type: "success",
        text: schedule.enabled
          ? "Scheduled bot join disabled."
          : "Scheduled bot join enabled.",
      });
      await loadScheduledBotJoins();
    } catch (toggleError) {
      setMessage({
        type: "error",
        text:
          toggleError instanceof Error
            ? toggleError.message
            : "Failed to update scheduled bot join.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelScheduledBotJoin(scheduleId: string) {
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/scheduled-bots/${scheduleId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "cancelled",
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to cancel scheduled bot join.");
      }

      setMessage({
        type: "success",
        text: "Scheduled bot join cancelled.",
      });
      await loadScheduledBotJoins();
    } catch (cancelError) {
      setMessage({
        type: "error",
        text:
          cancelError instanceof Error
            ? cancelError.message
            : "Failed to cancel scheduled bot join.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteScheduledBotJoin(scheduleId: string) {
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/scheduled-bots/${scheduleId}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete scheduled bot join.");
      }

      if (editingScheduleId === scheduleId) {
        setEditingScheduleId(null);
      }

      setMessage({
        type: "success",
        text: "Scheduled bot join deleted.",
      });
      await loadScheduledBotJoins();
    } catch (deleteError) {
      setMessage({
        type: "error",
        text:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete scheduled bot join.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function renderBotNamesEditor(
    formState: ScheduledBotJoinFormState,
    setFormState: Dispatch<SetStateAction<ScheduledBotJoinFormState>>,
    idPrefix: string,
  ) {
    return (
      <div className="bot-name-grid">
        {formState.botNames.map((botName, index) => (
          <div className="field" key={`${idPrefix}-bot-name-${index + 1}`}>
            <label htmlFor={`${idPrefix}-bot-name-${index + 1}`}>
              Bot {index + 1} Name
            </label>
            <input
              id={`${idPrefix}-bot-name-${index + 1}`}
              value={botName}
              onChange={(event) =>
                setFormState((current) => ({
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
    );
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Scheduled Bots</p>
          <h2>Schedule Recall bot joins</h2>
          <p className="muted">
            Local MVP only auto-runs while this page is open. Production should
            use cron/background worker.
          </p>
        </div>
      </section>

      {error ? <p className="message error">{error}</p> : null}
      {message ? <p className={`message ${message.type}`}>{message.text}</p> : null}

      <div className="form-shell">
        <section className="card">
          <div className="card-header">
            <h3>Create Scheduled Bot Join</h3>
            <p>
              Schedule bots to be created automatically at a specific date and
              time.
            </p>
          </div>
          <div className="card-body">
            <form className="form" onSubmit={handleCreateScheduledBotJoin}>
              <div className="field">
                <label htmlFor="scheduled-bot-name">Name</label>
                <input
                  id="scheduled-bot-name"
                  value={scheduleForm.name}
                  onChange={(event) =>
                    setScheduleForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="field-grid-3">
                <div className="field">
                  <label htmlFor="scheduled-bot-date">Scheduled date</label>
                  <input
                    id="scheduled-bot-date"
                    type="date"
                    value={scheduleForm.scheduledDate}
                    onChange={(event) =>
                      setScheduleForm((current) => ({
                        ...current,
                        scheduledDate: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="scheduled-bot-time">Scheduled time</label>
                  <input
                    id="scheduled-bot-time"
                    type="time"
                    value={scheduleForm.scheduledTime}
                    onChange={(event) =>
                      setScheduleForm((current) => ({
                        ...current,
                        scheduledTime: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="scheduled-bot-count">Number of bots</label>
                  <input
                    id="scheduled-bot-count"
                    type="number"
                    min="1"
                    max="20"
                    step="1"
                    value={scheduleForm.botCount}
                    onChange={(event) =>
                      setScheduleForm((current) => ({
                        ...current,
                        botCount: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
              </div>
              {renderBotNamesEditor(
                scheduleForm,
                setScheduleForm,
                "create-scheduled-bots",
              )}
              <div className="field">
                <label htmlFor="scheduled-bot-language">Transcript language</label>
                <input
                  id="scheduled-bot-language"
                  value={FIXED_TRANSCRIPT_LANGUAGE_LABEL}
                  readOnly
                />
                <p className="helper-text">
                  New scheduled joins always create bots with Chinese transcription.
                </p>
              </div>
              <label className="choice-item">
                <input
                  type="checkbox"
                  checked={scheduleForm.enabled}
                  onChange={(event) =>
                    setScheduleForm((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
                <span>Enabled</span>
              </label>
              <div className="actions">
                <button
                  className="button"
                  type="submit"
                  disabled={
                    submitting ||
                    sessionLoading ||
                    !hasCurrentSession ||
                    !currentSessionHasZoomUrl ||
                    Boolean(currentSessionBlockedMessage) ||
                    preflightErrors.length > 0
                  }
                >
                  {submitting ? "Saving..." : "Create scheduled bot join"}
                </button>
              </div>
            </form>
            <p className="helper-text">
              The first scheduled bot becomes the listener that transcribes.
              Extra scheduled bots are sender-only to reduce duplicate
              transcript load.
            </p>
          </div>
        </section>

        <div className="side-stack">
          <section className="card">
            <div className="card-header">
              <h3>Current Session</h3>
              <p>Scheduled joins always use the sidebar-selected session.</p>
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
              <h3>Schedule Notes</h3>
              <p>Local MVP only auto-runs while this page stays open.</p>
            </div>
            <div className="card-body">
              {!hasCurrentSession && !sessionLoading ? (
                <p className="message error">
                  Please select a session from the navigation bar first.
                </p>
              ) : null}
              {currentSessionBlockedMessage ? (
                <p className="message error">{currentSessionBlockedMessage}</p>
              ) : null}
              {!currentSessionHasZoomUrl && hasCurrentSession ? (
                <p className="message error">
                  Current session has no Zoom URL. Please add Zoom URL before
                  scheduling bots.
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
              <ul className="helper-list">
                <li>Scheduled joins use the session Zoom URL automatically.</li>
                <li>First bot listens and transcribes. Extra bots join as sender-only.</li>
                <li>If a schedule becomes due while this page is open, it runs on the next 10 second check.</li>
                <li>Production should replace page-open auto-run with cron or a worker.</li>
              </ul>
            </div>
          </section>
        </div>

        <section className="card form-shell-span">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Last auto-run</h3>
                <p>Due schedules are checked every 10 seconds while this page stays open.</p>
              </div>
              <div className="actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void loadScheduledBotJoins()}
                >
                  Refresh data
                </button>
              </div>
            </div>
          </div>
          <div className="card-body">
            <div className="log-meta">
              <span className="pill">
                Last auto-run time:{" "}
                {lastAutoRunTime ? formatTime(lastAutoRunTime) : "Never"}
              </span>
              <span className="pill">
                Processed: {lastAutoRunResult?.processedCount ?? 0}
              </span>
              <span className="pill">
                Completed: {lastAutoRunResult?.completedCount ?? 0}
              </span>
              <span className="pill">Failed: {lastAutoRunResult?.failedCount ?? 0}</span>
              <span className="pill">Not due yet: {lastAutoRunResult?.skippedCount ?? 0}</span>
            </div>
          </div>
        </section>

        <section className="card form-shell-span">
          <div className="card-header">
            <h3>Scheduled Bot Joins</h3>
            <p>Manage scheduled bot creation jobs and review their results.</p>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading scheduled bot joins...</div>
            ) : scheduledBotJoins.length === 0 ? (
              <div className="empty">No scheduled bot joins yet.</div>
            ) : (
              <div className="rule-list">
                {scheduledBotJoins.map((schedule) => {
                  const session =
                    meetingSessions.find((item) => item.id === schedule.sessionId) ??
                    null;
                  const isEditing = editingScheduleId === schedule.id;
                  const scheduleBelongsToCurrentSession =
                    schedule.sessionId === currentSessionId;

                  return (
                    <article className="rule-item" key={schedule.id}>
                      {isEditing ? (
                        <div className="form">
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
                          {!scheduleBelongsToCurrentSession ? (
                            <p className="message error">
                              This schedule belongs to another session. Switch to that session from the navigation bar first.
                            </p>
                          ) : null}
                          {currentSessionBlockedMessage ? (
                            <p className="message error">
                              {currentSessionBlockedMessage}
                            </p>
                          ) : null}
                          {!currentSessionHasZoomUrl ? (
                            <p className="message error">
                              Current session has no Zoom URL. Please add Zoom URL
                              before scheduling bots.
                            </p>
                          ) : null}
                          <div className="field">
                            <label htmlFor={`edit-scheduled-name-${schedule.id}`}>
                              Name
                            </label>
                            <input
                              id={`edit-scheduled-name-${schedule.id}`}
                              value={editingScheduleForm.name}
                              onChange={(event) =>
                                setEditingScheduleForm((current) => ({
                                  ...current,
                                  name: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-scheduled-date-${schedule.id}`}>
                              Scheduled date
                            </label>
                            <input
                              id={`edit-scheduled-date-${schedule.id}`}
                              type="date"
                              value={editingScheduleForm.scheduledDate}
                              onChange={(event) =>
                                setEditingScheduleForm((current) => ({
                                  ...current,
                                  scheduledDate: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-scheduled-time-${schedule.id}`}>
                              Scheduled time
                            </label>
                            <input
                              id={`edit-scheduled-time-${schedule.id}`}
                              type="time"
                              value={editingScheduleForm.scheduledTime}
                              onChange={(event) =>
                                setEditingScheduleForm((current) => ({
                                  ...current,
                                  scheduledTime: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-scheduled-count-${schedule.id}`}>
                              Number of bots
                            </label>
                            <input
                              id={`edit-scheduled-count-${schedule.id}`}
                              type="number"
                              min="1"
                              max="20"
                              step="1"
                              value={editingScheduleForm.botCount}
                              onChange={(event) =>
                                setEditingScheduleForm((current) => ({
                                  ...current,
                                  botCount: event.target.value,
                                }))
                              }
                            />
                          </div>
                          {renderBotNamesEditor(
                            editingScheduleForm,
                            setEditingScheduleForm,
                            `edit-scheduled-bots-${schedule.id}`,
                          )}
                          <div className="field">
                            <label
                              htmlFor={`edit-scheduled-language-${schedule.id}`}
                            >
                              Transcript language
                            </label>
                            <input
                              id={`edit-scheduled-language-${schedule.id}`}
                              value={FIXED_TRANSCRIPT_LANGUAGE_LABEL}
                              readOnly
                            />
                          </div>
                          <label className="choice-item">
                            <input
                              type="checkbox"
                              checked={editingScheduleForm.enabled}
                              onChange={(event) =>
                                setEditingScheduleForm((current) => ({
                                  ...current,
                                  enabled: event.target.checked,
                                }))
                              }
                            />
                            <span>Enabled</span>
                          </label>
                          <div className="actions">
                            <button
                              className="button"
                              type="button"
                              disabled={
                                submitting ||
                                !scheduleBelongsToCurrentSession ||
                                !currentSessionHasZoomUrl ||
                                Boolean(currentSessionBlockedMessage) ||
                                preflightErrors.length > 0
                              }
                              onClick={() => void handleSaveScheduledBotJoin(schedule.id)}
                            >
                              {submitting ? "Saving..." : "Save"}
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              onClick={() => setEditingScheduleId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <h3>{schedule.name}</h3>
                          <div className="rule-meta">
                            <span className={`pill status-${schedule.status}`}>
                              {schedule.status}
                            </span>
                            <span className="pill">
                              {schedule.enabled ? "enabled" : "disabled"}
                            </span>
                            <span className="pill">
                              Session: {session?.name ?? schedule.sessionId}
                            </span>
                            {session ? (
                              <span className="pill">
                                Session status: {session.status}
                              </span>
                            ) : null}
                            <span className="pill">
                              Scheduled for: {formatTime(schedule.scheduledAt)}
                            </span>
                            <span className="pill">Bots: {schedule.botCount}</span>
                            <span className="pill">
                              Last run:{" "}
                              {schedule.lastRunAt
                                ? formatTime(schedule.lastRunAt)
                                : "Never"}
                            </span>
                          </div>
                          <div className="code-block">
                            <p className="code">
                              Transcript language: {schedule.transcriptLanguage}
                            </p>
                            <p className="code">
                              Bot names: {schedule.botNames.join(", ")}
                            </p>
                            <p className="code">
                              Created bot IDs:{" "}
                              {schedule.createdBotIds.length > 0
                                ? schedule.createdBotIds.join(", ")
                                : "None yet"}
                            </p>
                            {schedule.errorMessage ? (
                              <p className="code error-text">
                                Error: {schedule.errorMessage}
                              </p>
                            ) : null}
                            {getSessionOperationBlockedMessage(session?.status) ? (
                              <p className="message error">
                                {getSessionOperationBlockedMessage(session?.status)}
                              </p>
                            ) : null}
                          </div>
                          <div className="actions">
                            <button
                              className="button secondary"
                              type="button"
                              disabled={
                                schedule.status === "running" ||
                                !scheduleBelongsToCurrentSession
                              }
                              onClick={() => startEditingSchedule(schedule)}
                            >
                              Edit
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={submitting || schedule.status === "running"}
                              onClick={() => void handleToggleScheduledBotJoin(schedule)}
                            >
                              {schedule.enabled ? "Disable" : "Enable"}
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={
                                submitting ||
                                schedule.status === "cancelled" ||
                                schedule.status === "running"
                              }
                              onClick={() =>
                                void handleCancelScheduledBotJoin(schedule.id)
                              }
                            >
                              Cancel Schedule
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={submitting || schedule.status === "running"}
                              onClick={() =>
                                void handleDeleteScheduledBotJoin(schedule.id)
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
