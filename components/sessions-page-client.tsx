"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  formatTime,
  readJsonResponse,
  type PanelMessage,
} from "@/components/control-panel-client";
import { useMeetingSession } from "@/components/meeting-session-context";
import { isBotActiveStatus } from "@/lib/bot-status";
import type {
  MeetingSession,
  MeetingSessionStatus,
  RecallBotRecord,
} from "@/lib/types";

type SessionFormState = {
  name: string;
  zoomUrl: string;
  notes: string;
};

const initialFormState: SessionFormState = {
  name: "",
  zoomUrl: "",
  notes: "",
};

export function SessionsPageClient() {
  const {
    currentSessionId,
    meetingSessions,
    refreshSessions,
    setCurrentSessionId,
  } = useMeetingSession();
  const [formState, setFormState] = useState<SessionFormState>(initialFormState);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingFormState, setEditingFormState] =
    useState<SessionFormState>(initialFormState);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [allBots, setAllBots] = useState<RecallBotRecord[]>([]);

  const activeSessionIds = useMemo(
    () =>
      new Set(
        allBots
          .filter((bot) => isBotActiveStatus(bot.status))
          .map((bot) => bot.sessionId),
      ),
    [allBots],
  );

  async function loadAllBots() {
    const response = await fetch("/api/recall/bots?pageSize=200", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Failed to load bots for session diagnostics.");
    }

    const payload = await readJsonResponse<{
      recallBots: RecallBotRecord[];
    }>(response);
    setAllBots(payload.recallBots);
  }

  async function refreshPageData() {
    await Promise.all([refreshSessions(), loadAllBots()]);
  }

  useEffect(() => {
    let active = true;

    async function loadInitialBots() {
      try {
        const response = await fetch("/api/recall/bots?pageSize=200", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Failed to load bots for session diagnostics.");
        }

        const payload = await readJsonResponse<{
          recallBots: RecallBotRecord[];
        }>(response);

        if (active) {
          setAllBots(payload.recallBots);
        }
      } catch {
        // Session page can still render if bot diagnostics fail to load once.
      }
    }

    void loadInitialBots();

    return () => {
      active = false;
    };
  }, []);

  function startEditing(session: MeetingSession) {
    setEditingSessionId(session.id);
    setEditingFormState({
      name: session.name,
      zoomUrl: session.zoomUrl,
      notes: session.notes,
    });
    setMessage(null);
  }

  async function handleCreateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formState),
      });
      const payload = await readJsonResponse<{
        error?: string;
        meetingSession?: MeetingSession;
      }>(response);

      if (!response.ok || !payload.meetingSession) {
        throw new Error(payload.error ?? "Failed to create session.");
      }

      setFormState(initialFormState);
      await refreshPageData();
      setCurrentSessionId(payload.meetingSession.id);
      setMessage({
        type: "success",
        text: `Session "${payload.meetingSession.name}" created.`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to create session.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateSession(
    sessionId: string,
    updates: Partial<SessionFormState> & { status?: MeetingSessionStatus },
    successText: string,
  ) {
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      const payload = await readJsonResponse<{
        error?: string;
        meetingSession?: MeetingSession;
      }>(response);

      if (!response.ok || !payload.meetingSession) {
        throw new Error(payload.error ?? "Failed to update session.");
      }

      setEditingSessionId(null);
      await refreshPageData();
      setMessage({
        type: "success",
        text: successText,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to update session.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteSession(sessionId: string) {
    const confirmed = window.confirm(
      "Delete this session? Active bots must already be stopped. Historical records will move to Default Session.",
    );

    if (!confirmed) {
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete session.");
      }

      await refreshPageData();
      if (currentSessionId === sessionId) {
        setCurrentSessionId("default-session");
      }
      setMessage({
        type: "success",
        text: "Session deleted. Related records were reassigned to Default Session.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to delete session.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEndSession(session: MeetingSession) {
    const confirmed = window.confirm(
      `End session "${session.name}"? This will stop active bots in the session, mark the session as ended, and cancel pending scheduled bot joins.`,
    );

    if (!confirmed) {
      return;
    }

    await handleUpdateSession(
      session.id,
      { status: "ended" },
      "Session ended. Active bot stop attempts were sent and pending schedules were cancelled.",
    );
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Sessions</p>
          <h2>Meeting sessions</h2>
          <p className="muted">
            Group bots, triggers, timers, live chat, and logs by meeting session.
          </p>
        </div>
      </section>

      {message ? <p className={`message ${message.type}`}>{message.text}</p> : null}

      <div className="form-shell">
        <section className="card">
          <div className="card-header">
            <h3>Create Session</h3>
            <p>
              Sessions start as drafts. Add the Zoom URL here because `/bots`
              creates Recall bots from the selected session&apos;s Zoom URL.
            </p>
          </div>
          <div className="card-body">
            <form className="form" onSubmit={handleCreateSession}>
              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor="session-name">Session Name</label>
                  <input
                    id="session-name"
                    value={formState.name}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="session-zoom-url">Zoom URL</label>
                  <input
                    id="session-zoom-url"
                    value={formState.zoomUrl}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        zoomUrl: event.target.value,
                      }))
                    }
                    placeholder="https://zoom.us/j/..."
                  />
                  <p className="helper-text">
                    This Zoom URL is what the bot creation form will use.
                  </p>
                </div>
              </div>
              <div className="field">
                <label htmlFor="session-notes">Notes</label>
                <textarea
                  id="session-notes"
                  value={formState.notes}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="actions">
                <button className="button" type="submit" disabled={submitting}>
                  {submitting ? "Saving..." : "Create Session"}
                </button>
              </div>
            </form>
          </div>
        </section>

        <div className="side-stack">
          <section className="card">
            <div className="card-header">
              <h3>Current Session Context</h3>
              <p>The sidebar Current Session controls the other admin pages.</p>
            </div>
            <div className="card-body">
              <div className="editor-context">
                <div className="setting-item">
                  <span className="setting-label">Current Session</span>
                  <span className="setting-value">
                    {meetingSessions.find((session) => session.id === currentSessionId)
                      ?.name ?? "Default Session"}
                  </span>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Sessions Saved</span>
                  <span className="setting-value">{meetingSessions.length}</span>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Active Sessions</span>
                  <span className="setting-value">{activeSessionIds.size}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h3>Session Tips</h3>
            </div>
            <div className="card-body">
              <ul className="helper-list">
                <li>Set the Zoom URL here before creating bots or scheduled joins.</li>
                <li>Start the session when you are ready to create or schedule bots.</li>
                <li>End Session will stop active bots and cancel pending schedules.</li>
              </ul>
            </div>
          </section>
        </div>

        <section className="card form-shell-span">
          <div className="card-header">
            <h3>Sessions List</h3>
            <p>Current Session drives what the other admin pages show.</p>
          </div>
          <div className="card-body">
            <div className="rule-list">
              {meetingSessions.map((session) => {
                const isEditing = editingSessionId === session.id;
                const hasActiveBots = activeSessionIds.has(session.id);

                return (
                  <article className="rule-item" key={session.id}>
                    {isEditing ? (
                      <div className="form">
                        <div className="field">
                          <label htmlFor={`edit-session-name-${session.id}`}>Session Name</label>
                          <input
                            id={`edit-session-name-${session.id}`}
                            value={editingFormState.name}
                            onChange={(event) =>
                              setEditingFormState((current) => ({
                                ...current,
                                name: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-session-zoom-${session.id}`}>Zoom URL</label>
                          <input
                            id={`edit-session-zoom-${session.id}`}
                            value={editingFormState.zoomUrl}
                            disabled={hasActiveBots}
                            onChange={(event) =>
                              setEditingFormState((current) => ({
                                ...current,
                                zoomUrl: event.target.value,
                              }))
                            }
                          />
                          {hasActiveBots ? (
                            <p className="message error">
                              Cannot change Zoom URL while this session has active
                              bots.
                            </p>
                          ) : (
                            <p className="helper-text">
                              Bots created in this session will use this Zoom URL.
                            </p>
                          )}
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-session-notes-${session.id}`}>Notes</label>
                          <textarea
                            id={`edit-session-notes-${session.id}`}
                            value={editingFormState.notes}
                            onChange={(event) =>
                              setEditingFormState((current) => ({
                                ...current,
                                notes: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="actions">
                          <button
                            className="button"
                            type="button"
                            disabled={submitting}
                            onClick={() =>
                              void handleUpdateSession(
                                session.id,
                                editingFormState,
                                "Session updated.",
                              )
                            }
                          >
                            {submitting ? "Saving..." : "Save"}
                          </button>
                          <button
                            className="button secondary"
                            type="button"
                            onClick={() => setEditingSessionId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3>{session.name}</h3>
                        <div className="rule-meta">
                          <span className="pill">Status: {session.status}</span>
                          <span className="pill">
                            Created: {formatTime(session.createdAt)}
                          </span>
                          <span className="pill">
                            Updated: {formatTime(session.updatedAt)}
                          </span>
                          <span className="pill">
                            Started: {session.startedAt ? formatTime(session.startedAt) : "Not started"}
                          </span>
                          <span className="pill">
                            Ended: {session.endedAt ? formatTime(session.endedAt) : "Not ended"}
                          </span>
                          {currentSessionId === session.id ? (
                            <span className="pill">Current Session</span>
                          ) : null}
                        </div>
                        <div className="code-block">
                          <p className="code">Zoom URL: {session.zoomUrl || "(empty)"}</p>
                          <p className="code">Notes: {session.notes || "(none)"}</p>
                        </div>
                        {hasActiveBots ? (
                          <p className="message error">
                            Cannot change Zoom URL while this session has active
                            bots.
                          </p>
                        ) : null}
                        <div className="actions">
                          <button
                            className="button secondary"
                            type="button"
                            onClick={() => setCurrentSessionId(session.id)}
                          >
                            Use As Current Session
                          </button>
                          <button
                            className="button secondary"
                            type="button"
                            onClick={() => startEditing(session)}
                          >
                            Edit
                          </button>
                          <button
                            className="button secondary"
                            type="button"
                            disabled={submitting || session.status === "active"}
                            onClick={() =>
                              void handleUpdateSession(
                                session.id,
                                { status: "active" },
                                "Session started.",
                              )
                            }
                          >
                            Start Session
                          </button>
                          <button
                            className="button secondary"
                            type="button"
                            disabled={submitting || session.status === "ended"}
                            onClick={() => void handleEndSession(session)}
                          >
                            End Session
                          </button>
                          <button
                            className="button secondary"
                            type="button"
                            disabled={submitting || session.status === "archived"}
                            onClick={() =>
                              void handleUpdateSession(
                                session.id,
                                { status: "archived" },
                                "Session archived.",
                              )
                            }
                          >
                            Archive Session
                          </button>
                          <button
                            className="button secondary"
                            type="button"
                            disabled={submitting || session.id === "default-session"}
                            onClick={() => void handleDeleteSession(session.id)}
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
          </div>
        </section>
      </div>
    </div>
  );
}
