"use client";

import {
  Dispatch,
  FormEvent,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isBotActiveStatus } from "@/lib/bot-status";
import {
  formatTime,
  readJsonResponse,
  type PanelMessage,
} from "@/components/control-panel-client";
import { useMeetingSession } from "@/components/meeting-session-context";
import { getSessionOperationBlockedMessage } from "@/lib/session-operations";
import type {
  RecallBotRecord,
  TimerTrigger,
  TimerTriggerLog,
  TimerTriggerSenderMode,
} from "@/lib/types";

type TimerTriggerFormState = {
  name: string;
  delayMinutesAfterJoin: string;
  message: string;
  senderMode: TimerTriggerSenderMode;
  senderBotIds: string[];
  responseDelaySeconds: string;
  maxTriggerCount: string;
};

type RunDueResult = {
  meetingJoinedAt: string | null;
  executedCount: number;
  skippedCount: number;
  timerTriggerLogs: TimerTriggerLog[];
} | null;

type SelectedBotWarning = {
  senderBotId: string;
  message: string;
};

const initialTimerTriggerForm: TimerTriggerFormState = {
  name: "",
  delayMinutesAfterJoin: "1",
  message: "",
  senderMode: "round_robin_bots",
  senderBotIds: [],
  responseDelaySeconds: "0",
  maxTriggerCount: "",
};

export function TimerTriggersPageClient() {
  const { currentSession, currentSessionId, loading: sessionLoading } =
    useMeetingSession();
  const [timerTriggers, setTimerTriggers] = useState<TimerTrigger[]>([]);
  const [timerTriggerLogs, setTimerTriggerLogs] = useState<TimerTriggerLog[]>([]);
  const [recallBots, setRecallBots] = useState<RecallBotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timerTriggerSubmitting, setTimerTriggerSubmitting] = useState(false);
  const [runningDueTimers, setRunningDueTimers] = useState(false);
  const [timerTriggerMessage, setTimerTriggerMessage] = useState<PanelMessage>(null);
  const [lastAutoRunTime, setLastAutoRunTime] = useState<string | null>(null);
  const [lastAutoRunResult, setLastAutoRunResult] = useState<RunDueResult>(null);
  const [timerTriggerForm, setTimerTriggerForm] =
    useState<TimerTriggerFormState>(initialTimerTriggerForm);
  const [editingTimerTriggerId, setEditingTimerTriggerId] = useState<string | null>(
    null,
  );
  const [editingTimerTriggerForm, setEditingTimerTriggerForm] =
    useState<TimerTriggerFormState>(initialTimerTriggerForm);
  const isRunDueTimersInFlightRef = useRef(false);

  const activeBots = useMemo(
    () => recallBots.filter((bot) => isBotActiveStatus(bot.status)),
    [recallBots],
  );
  const earliestJoinedAt = useMemo(() => {
    const joinedAtValues = activeBots
      .map((bot) => bot.joinedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());

    return joinedAtValues[0] ?? null;
  }, [activeBots]);
  const currentSessionBlockedMessage = getSessionOperationBlockedMessage(
    currentSession?.status,
  );

  async function loadTimerTriggerData() {
    const [triggersResponse, logsResponse, botsResponse] = await Promise.all([
      fetch(`/api/timer-triggers?sessionId=${encodeURIComponent(currentSessionId)}`, {
        cache: "no-store",
      }),
      fetch(
        `/api/logs/timer-trigger?sessionId=${encodeURIComponent(currentSessionId)}`,
        { cache: "no-store" },
      ),
      fetch(
        `/api/recall/bots?sessionId=${encodeURIComponent(currentSessionId)}&pageSize=200`,
        { cache: "no-store" },
      ),
    ]);

    if (!triggersResponse.ok || !logsResponse.ok || !botsResponse.ok) {
      throw new Error("Failed to load timer triggers.");
    }

    const triggersPayload = await readJsonResponse<{
      timerTriggers: TimerTrigger[];
    }>(triggersResponse);
    const logsPayload = await readJsonResponse<{
      timerTriggerLogs: TimerTriggerLog[];
    }>(logsResponse);
    const botsPayload = await readJsonResponse<{
      recallBots: RecallBotRecord[];
    }>(botsResponse);

    setTimerTriggers(triggersPayload.timerTriggers);
    setTimerTriggerLogs(logsPayload.timerTriggerLogs);
    setRecallBots(botsPayload.recallBots);
    setError(null);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        await loadTimerTriggerData();
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load timer triggers.",
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

  function getUnavailableSelectedBots(senderBotIds: string[]): SelectedBotWarning[] {
    return senderBotIds.flatMap((senderBotId) => {
      const selectedBot = recallBots.find(
        (bot) => bot.recallBotId === senderBotId,
      );

      if (!selectedBot) {
        return [
          {
            senderBotId,
            message: `Selected sender bot is missing: ${senderBotId}`,
          },
        ];
      }

      if (!isBotActiveStatus(selectedBot.status)) {
        return [
          {
            senderBotId,
            message: `Selected sender bot is not active: ${selectedBot.botName} (${selectedBot.recallBotId})`,
          },
        ];
      }

      return [];
    });
  }

  function getSelectedBotSummaries(senderBotIds: string[]): string[] {
    return senderBotIds.map((senderBotId) => {
      const selectedBot = recallBots.find(
        (bot) => bot.recallBotId === senderBotId,
      );

      if (!selectedBot) {
        return `${senderBotId} (missing)`;
      }

      return `${selectedBot.botName} (${selectedBot.recallBotId})`;
    });
  }

  function toggleSenderBot(
    setter: Dispatch<SetStateAction<TimerTriggerFormState>>,
    senderBotId: string,
  ) {
    setter((current) => ({
      ...current,
      senderBotIds: current.senderBotIds.includes(senderBotId)
        ? current.senderBotIds.filter((botId) => botId !== senderBotId)
        : [...current.senderBotIds, senderBotId],
    }));
  }

  function removeSenderBot(
    setter: Dispatch<SetStateAction<TimerTriggerFormState>>,
    senderBotId: string,
  ) {
    setter((current) => ({
      ...current,
      senderBotIds: current.senderBotIds.filter((botId) => botId !== senderBotId),
    }));
  }

  function startEditingTimerTrigger(timerTrigger: TimerTrigger) {
    setEditingTimerTriggerId(timerTrigger.id);
    setEditingTimerTriggerForm({
      name: timerTrigger.name,
      delayMinutesAfterJoin: String(timerTrigger.delayMinutesAfterJoin),
      message: timerTrigger.message,
      senderMode: timerTrigger.senderMode,
      senderBotIds: timerTrigger.senderBotIds,
      responseDelaySeconds: String(timerTrigger.responseDelaySeconds),
      maxTriggerCount: timerTrigger.maxTriggerCount
        ? String(timerTrigger.maxTriggerCount)
        : "",
    });
    setTimerTriggerMessage(null);
  }

  async function handleCreateTimerTrigger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTimerTriggerSubmitting(true);
    setTimerTriggerMessage(null);

    try {
      const response = await fetch("/api/timer-triggers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: currentSessionId,
          name: timerTriggerForm.name,
          delayMinutesAfterJoin: Number(timerTriggerForm.delayMinutesAfterJoin),
          message: timerTriggerForm.message,
          senderMode: timerTriggerForm.senderMode,
          senderBotIds:
            timerTriggerForm.senderMode === "specific_bots"
              ? timerTriggerForm.senderBotIds
              : [],
          responseDelaySeconds: Number(timerTriggerForm.responseDelaySeconds),
          maxTriggerCount:
            timerTriggerForm.maxTriggerCount.trim() === ""
              ? null
              : Number(timerTriggerForm.maxTriggerCount),
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create timer trigger.");
      }

      setTimerTriggerForm(initialTimerTriggerForm);
      setTimerTriggerMessage({
        type: "success",
        text: "Timer trigger created.",
      });
      await loadTimerTriggerData();
    } catch (createError) {
      setTimerTriggerMessage({
        type: "error",
        text:
          createError instanceof Error
            ? createError.message
            : "Failed to create timer trigger.",
      });
    } finally {
      setTimerTriggerSubmitting(false);
    }
  }

  async function handleSaveTimerTrigger(timerTriggerId: string) {
    setTimerTriggerSubmitting(true);
    setTimerTriggerMessage(null);

    try {
      const response = await fetch(`/api/timer-triggers/${timerTriggerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editingTimerTriggerForm.name,
          delayMinutesAfterJoin: Number(
            editingTimerTriggerForm.delayMinutesAfterJoin,
          ),
          message: editingTimerTriggerForm.message,
          senderMode: editingTimerTriggerForm.senderMode,
          senderBotIds:
            editingTimerTriggerForm.senderMode === "specific_bots"
              ? editingTimerTriggerForm.senderBotIds
              : [],
          responseDelaySeconds: Number(
            editingTimerTriggerForm.responseDelaySeconds,
          ),
          maxTriggerCount:
            editingTimerTriggerForm.maxTriggerCount.trim() === ""
              ? null
              : Number(editingTimerTriggerForm.maxTriggerCount),
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update timer trigger.");
      }

      setEditingTimerTriggerId(null);
      setTimerTriggerMessage({
        type: "success",
        text: "Timer trigger updated.",
      });
      await loadTimerTriggerData();
    } catch (saveError) {
      setTimerTriggerMessage({
        type: "error",
        text:
          saveError instanceof Error
            ? saveError.message
            : "Failed to update timer trigger.",
      });
    } finally {
      setTimerTriggerSubmitting(false);
    }
  }

  async function handleToggleTimerTrigger(timerTrigger: TimerTrigger) {
    setTimerTriggerSubmitting(true);
    setTimerTriggerMessage(null);

    try {
      const response = await fetch(`/api/timer-triggers/${timerTrigger.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: !timerTrigger.enabled,
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update timer trigger.");
      }

      setTimerTriggerMessage({
        type: "success",
        text: timerTrigger.enabled
          ? "Timer trigger disabled."
          : "Timer trigger enabled.",
      });
      await loadTimerTriggerData();
    } catch (toggleError) {
      setTimerTriggerMessage({
        type: "error",
        text:
          toggleError instanceof Error
            ? toggleError.message
            : "Failed to update timer trigger.",
      });
    } finally {
      setTimerTriggerSubmitting(false);
    }
  }

  async function handleDeleteTimerTrigger(timerTriggerId: string) {
    setTimerTriggerSubmitting(true);
    setTimerTriggerMessage(null);

    try {
      const response = await fetch(`/api/timer-triggers/${timerTriggerId}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete timer trigger.");
      }

      if (editingTimerTriggerId === timerTriggerId) {
        setEditingTimerTriggerId(null);
      }

      setTimerTriggerMessage({
        type: "success",
        text: "Timer trigger deleted.",
      });
      await loadTimerTriggerData();
    } catch (deleteError) {
      setTimerTriggerMessage({
        type: "error",
        text:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete timer trigger.",
      });
    } finally {
      setTimerTriggerSubmitting(false);
    }
  }

  async function handleDeleteTimerTriggerLog(logId: string) {
    setTimerTriggerMessage(null);

    try {
      const response = await fetch(`/api/logs/timer-trigger/${logId}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete timer trigger log.");
      }

      setTimerTriggerMessage({
        type: "success",
        text: "Timer trigger log deleted.",
      });
      await loadTimerTriggerData();
    } catch (deleteError) {
      setTimerTriggerMessage({
        type: "error",
        text:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete timer trigger log.",
      });
    }
  }

  async function handleClearTimerTriggerLogs() {
    setTimerTriggerMessage(null);

    try {
      const response = await fetch(
        `/api/logs/timer-trigger?sessionId=${encodeURIComponent(currentSessionId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to clear timer trigger logs.");
      }

      setTimerTriggerMessage({
        type: "success",
        text: "Timer trigger logs cleared.",
      });
      await loadTimerTriggerData();
    } catch (clearError) {
      setTimerTriggerMessage({
        type: "error",
        text:
          clearError instanceof Error
            ? clearError.message
            : "Failed to clear timer trigger logs.",
      });
    }
  }

  async function performRunDueTimers() {
    if (isRunDueTimersInFlightRef.current) {
      return;
    }

    if (currentSessionBlockedMessage) {
      setLastAutoRunTime(new Date().toISOString());
      setLastAutoRunResult(null);
      return;
    }

    isRunDueTimersInFlightRef.current = true;
    setRunningDueTimers(true);

    try {
      const response = await fetch(
        `/api/timer-triggers/run-due?sessionId=${encodeURIComponent(currentSessionId)}`,
        {
          method: "POST",
        },
      );
      const payload = await readJsonResponse<
        RunDueResult & {
          error?: string;
        }
      >(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to run due timer triggers.");
      }

      setLastAutoRunTime(new Date().toISOString());
      setLastAutoRunResult({
        meetingJoinedAt: payload.meetingJoinedAt,
        executedCount: payload.executedCount,
        skippedCount: payload.skippedCount,
        timerTriggerLogs: payload.timerTriggerLogs,
      });

      await loadTimerTriggerData();
    } catch (runError) {
      setLastAutoRunTime(new Date().toISOString());
      setLastAutoRunResult(null);
      setTimerTriggerMessage({
        type: "error",
        text:
          runError instanceof Error
            ? `Timer auto-run failed: ${runError.message}`
            : "Timer auto-run failed.",
      });
    } finally {
      isRunDueTimersInFlightRef.current = false;
      setRunningDueTimers(false);
    }
  }

  useEffect(() => {
    const interval = window.setInterval(() => {
      void performRunDueTimers();
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  function renderSenderSelector(
    formState: TimerTriggerFormState,
    setter: Dispatch<SetStateAction<TimerTriggerFormState>>,
    idPrefix: string,
    currentNextSenderIndex = 0,
  ) {
    const unavailableSelectedBots = getUnavailableSelectedBots(
      formState.senderBotIds,
    );
    const selectedActiveBots = activeBots.filter((bot) =>
      formState.senderBotIds.includes(bot.recallBotId),
    );
    const normalizedNextSenderIndex =
      activeBots.length > 0
        ? Math.max(0, Math.floor(currentNextSenderIndex)) % activeBots.length
        : null;
    const nextSenderBot =
      normalizedNextSenderIndex === null
        ? null
        : activeBots[normalizedNextSenderIndex];

    return (
      <>
        <div className="field">
          <label htmlFor={`${idPrefix}-sender-mode`}>Sender Mode</label>
          <select
            id={`${idPrefix}-sender-mode`}
            value={formState.senderMode}
            onChange={(event) =>
              setter((current) => ({
                ...current,
                senderMode: event.target.value as TimerTriggerSenderMode,
                senderBotIds:
                  event.target.value === "specific_bots" ? current.senderBotIds : [],
              }))
            }
          >
            <option value="round_robin_bots">Round-robin bot(s)</option>
            <option value="specific_bots">Specific bot(s)</option>
            <option value="all_bots">All bot(s)</option>
          </select>
          {formState.senderMode === "round_robin_bots" ? (
            <p className="muted">
              Round-robin uses all current Active Bots and sends from one bot at
              a time.
            </p>
          ) : null}
          {formState.senderMode === "all_bots" ? (
            <p className="muted">
              All current Active Bots send the same message once per timer
              execution.
            </p>
          ) : null}
        </div>

        {formState.senderMode === "specific_bots" ? (
          <div className="field">
            <label>Specific sender bot(s)</label>
            {recallBots.length === 0 ? (
              <div className="empty">No saved bots yet. You can assign bots later.</div>
            ) : (
              <div className="choice-stack">
                <div className="choice-group">
                  <p className="choice-title">Active / In Meeting Bots</p>
                  {activeBots.length === 0 ? (
                    <p className="muted">No active bots right now.</p>
                  ) : (
                    <div className="choice-list">
                      {activeBots.map((bot) => (
                        <label className="choice-item" key={bot.id}>
                          <input
                            type="checkbox"
                            checked={formState.senderBotIds.includes(
                              bot.recallBotId,
                            )}
                            onChange={() => toggleSenderBot(setter, bot.recallBotId)}
                          />
                          <span>
                            {bot.botName} ({bot.recallBotId})
                          </span>
                          <span className="muted">Status: {bot.status}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
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
                No bots assigned yet. Timer will not run until at least one bot
                is assigned.
              </p>
            )}
            {unavailableSelectedBots.length > 0 ? (
              <div className="warning-list">
                {unavailableSelectedBots.map((warning) => (
                  <div className="inline-warning" key={warning.senderBotId}>
                    <p className="message error">{warning.message}</p>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => removeSenderBot(setter, warning.senderBotId)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="field">
            <label>Active bot preview</label>
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
            {formState.senderMode === "round_robin_bots" && nextSenderBot ? (
              <p className="code">
                Next sender preview: {nextSenderBot.botName} (
                {nextSenderBot.recallBotId}) at index {normalizedNextSenderIndex}
              </p>
            ) : null}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Timer Triggers</p>
          <h2>Run chat timers after bots join</h2>
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
      {timerTriggerMessage ? (
        <p className={`message ${timerTriggerMessage.type}`}>
          {timerTriggerMessage.text}
        </p>
      ) : null}

      <div className="form-shell">
        <section className="card">
          <div className="card-header">
            <h3>Create Timer Trigger</h3>
            <p>
              Use the earliest joined active bot as the meeting start reference
              and choose how timer messages should be sent when due.
            </p>
          </div>
          <div className="card-body">
            <form className="form" onSubmit={handleCreateTimerTrigger}>
              <div className="field">
                <label htmlFor="timer-trigger-name">Name</label>
                <input
                  id="timer-trigger-name"
                  value={timerTriggerForm.name}
                  onChange={(event) =>
                    setTimerTriggerForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="8-minute beginner question"
                  required
                />
              </div>
              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor="timer-trigger-delay">Delay minutes after join</label>
                  <input
                    id="timer-trigger-delay"
                    type="number"
                    min="0"
                    step="1"
                    value={timerTriggerForm.delayMinutesAfterJoin}
                    onChange={(event) =>
                      setTimerTriggerForm((current) => ({
                        ...current,
                        delayMinutesAfterJoin: event.target.value,
                      }))
                    }
                    required
                  />
                  <p className="muted">
                    Timer delay is calculated from the earliest active bot
                    joinedAt. If the scheduled time has already passed, it will
                    run on the next auto-run check.
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="timer-trigger-response-delay">
                    Response delay seconds
                  </label>
                  <input
                    id="timer-trigger-response-delay"
                    type="number"
                    min="0"
                    max="300"
                    step="1"
                    value={timerTriggerForm.responseDelaySeconds}
                    onChange={(event) =>
                      setTimerTriggerForm((current) => ({
                        ...current,
                        responseDelaySeconds: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="timer-trigger-message">Message</label>
                <textarea
                  id="timer-trigger-message"
                  value={timerTriggerForm.message}
                  onChange={(event) =>
                    setTimerTriggerForm((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                  placeholder="我想问一下这个配套适合新手吗？"
                  required
                />
              </div>

              {renderSenderSelector(timerTriggerForm, setTimerTriggerForm, "create")}
              <div className="field">
                <label htmlFor="timer-trigger-max-count">Max trigger count</label>
                <input
                  id="timer-trigger-max-count"
                  type="number"
                  min="0"
                  step="1"
                  value={timerTriggerForm.maxTriggerCount}
                  onChange={(event) =>
                    setTimerTriggerForm((current) => ({
                      ...current,
                      maxTriggerCount: event.target.value,
                    }))
                  }
                  placeholder="0"
                />
                <p className="muted">Empty or 0 = unlimited</p>
              </div>
              <div className="actions">
                <button
                  className="button"
                  type="submit"
                  disabled={
                    timerTriggerSubmitting || Boolean(currentSessionBlockedMessage)
                  }
                >
                  {timerTriggerSubmitting ? "Saving..." : "Create timer trigger"}
                </button>
              </div>
            </form>
          </div>
        </section>

        <div className="side-stack">
          <section className="card">
            <div className="card-header">
              <h3>Current Session</h3>
              <p>Timer triggers use only active bots from this session.</p>
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
                  <span className="setting-label">Earliest Active Bot joinedAt</span>
                  <span className="setting-value">
                    {earliestJoinedAt ? formatTime(earliestJoinedAt) : "Not available"}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h3>Timer Notes</h3>
            </div>
            <div className="card-body">
              <ul className="helper-list">
                <li>Overdue timers run on the next auto-run cycle while this page is open.</li>
                <li>Specific-bots timers with no assigned bots wait silently until bots are assigned.</li>
                <li>Production should move due-timer checks into cron or a worker.</li>
              </ul>
              {activeBots.length === 0 ? (
                <p className="message warning">
                  No active bots are available yet. Timers can still be created now.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="card form-shell-span">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Timer Triggers</h3>
                <p>
                  Auto-run checks due timers every 10 seconds while this page is
                  open.
                </p>
              </div>
              <div className="actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void loadTimerTriggerData()}
                >
                  Refresh data
                </button>
              </div>
            </div>
          </div>
          <div className="card-body">
            <div className="result-block">
              <h4>Last auto-run</h4>
              <div className="log-meta">
                <span className="pill">
                  Status: {runningDueTimers ? "Running..." : "Active"}
                </span>
                <span className="pill">
                  Last auto-run time:{" "}
                  {lastAutoRunTime ? formatTime(lastAutoRunTime) : "Never"}
                </span>
                <span className="pill">
                  Executed: {lastAutoRunResult?.executedCount ?? 0}
                </span>
                <span className="pill">
                  Skipped: {lastAutoRunResult?.skippedCount ?? 0}
                </span>
              </div>
              {lastAutoRunResult ? (
                <p className="code">
                  Meeting joinedAt reference:{" "}
                  {lastAutoRunResult.meetingJoinedAt
                    ? formatTime(lastAutoRunResult.meetingJoinedAt)
                    : "None"}
                </p>
              ) : null}
            </div>

            {loading ? (
              <div className="empty">Loading timer triggers...</div>
            ) : timerTriggers.length === 0 ? (
              <div className="empty">No timer triggers yet.</div>
            ) : (
              <div className="rule-list">
                {timerTriggers.map((timerTrigger) => {
                  const isEditing = editingTimerTriggerId === timerTrigger.id;
                  const selectedBotSummaries = getSelectedBotSummaries(
                    timerTrigger.senderBotIds,
                  );
                  const selectedBotWarnings = getUnavailableSelectedBots(
                    timerTrigger.senderBotIds,
                  );

                  return (
                    <article className="rule-item" key={timerTrigger.id}>
                      {isEditing ? (
                        <div className="form">
                          <div className="field">
                            <label htmlFor={`edit-timer-name-${timerTrigger.id}`}>
                              Name
                            </label>
                            <input
                              id={`edit-timer-name-${timerTrigger.id}`}
                              value={editingTimerTriggerForm.name}
                              onChange={(event) =>
                                setEditingTimerTriggerForm((current) => ({
                                  ...current,
                                  name: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-timer-delay-${timerTrigger.id}`}>
                              Delay minutes after join
                            </label>
                            <input
                              id={`edit-timer-delay-${timerTrigger.id}`}
                              type="number"
                              min="0"
                              step="1"
                              value={editingTimerTriggerForm.delayMinutesAfterJoin}
                              onChange={(event) =>
                                setEditingTimerTriggerForm((current) => ({
                                  ...current,
                                  delayMinutesAfterJoin: event.target.value,
                                }))
                              }
                              />
                              <p className="muted">
                                Timer delay is calculated from the earliest
                                active bot joinedAt. If the scheduled time has
                                already passed, it will run on the next
                                auto-run check.
                              </p>
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-timer-message-${timerTrigger.id}`}>
                              Message
                            </label>
                            <textarea
                              id={`edit-timer-message-${timerTrigger.id}`}
                              value={editingTimerTriggerForm.message}
                              onChange={(event) =>
                                setEditingTimerTriggerForm((current) => ({
                                  ...current,
                                  message: event.target.value,
                                }))
                              }
                            />
                          </div>

                          {renderSenderSelector(
                            editingTimerTriggerForm,
                            setEditingTimerTriggerForm,
                            `edit-${timerTrigger.id}`,
                            timerTrigger.nextSenderIndex,
                          )}

                          <div className="field">
                            <label
                              htmlFor={`edit-timer-response-delay-${timerTrigger.id}`}
                            >
                              Response delay seconds
                            </label>
                            <input
                              id={`edit-timer-response-delay-${timerTrigger.id}`}
                              type="number"
                              min="0"
                              max="300"
                              step="1"
                              value={editingTimerTriggerForm.responseDelaySeconds}
                              onChange={(event) =>
                                setEditingTimerTriggerForm((current) => ({
                                  ...current,
                                  responseDelaySeconds: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label
                              htmlFor={`edit-timer-max-count-${timerTrigger.id}`}
                            >
                              Max trigger count
                            </label>
                            <input
                              id={`edit-timer-max-count-${timerTrigger.id}`}
                              type="number"
                              min="0"
                              step="1"
                              value={editingTimerTriggerForm.maxTriggerCount}
                              onChange={(event) =>
                                setEditingTimerTriggerForm((current) => ({
                                  ...current,
                                  maxTriggerCount: event.target.value,
                                }))
                              }
                              placeholder="0"
                            />
                            <p className="muted">Empty or 0 = unlimited</p>
                          </div>
                          <div className="actions">
                            <button
                              className="button"
                              type="button"
                              disabled={timerTriggerSubmitting}
                              onClick={() => void handleSaveTimerTrigger(timerTrigger.id)}
                            >
                              {timerTriggerSubmitting ? "Saving..." : "Save"}
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              onClick={() => setEditingTimerTriggerId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <h3>{timerTrigger.name}</h3>
                          <p className="muted">{timerTrigger.message}</p>
                          <div className="rule-meta">
                            <span
                              className={`pill status-${
                                timerTrigger.enabled ? "sent" : "unknown"
                              }`}
                            >
                              {timerTrigger.enabled ? "enabled" : "disabled"}
                            </span>
                            <span className="pill">
                              Delay after join: {timerTrigger.delayMinutesAfterJoin}m
                            </span>
                            <span className="pill">
                              Sender mode: {timerTrigger.senderMode}
                            </span>
                            <span className="pill">
                              Response delay: {timerTrigger.responseDelaySeconds}s
                            </span>
                            <span className="pill">
                              Usage: {timerTrigger.triggerCount} /{" "}
                              {timerTrigger.maxTriggerCount ?? "unlimited"}
                            </span>
                            <span className="pill">
                              Last triggered:{" "}
                              {timerTrigger.lastTriggeredAt
                                ? formatTime(timerTrigger.lastTriggeredAt)
                                : "Never"}
                            </span>
                          </div>
                          <div className="code-block">
                            {timerTrigger.senderMode === "specific_bots" ? (
                              <>
                                <p className="code">
                                  Sender bots:{" "}
                                  {selectedBotSummaries.length > 0
                                    ? selectedBotSummaries.join(", ")
                                    : "None selected"}
                                </p>
                                {selectedBotSummaries.length === 0 ? (
                                  <p className="message error">
                                    No bots assigned yet. Timer will not run
                                    until at least one bot is assigned.
                                  </p>
                                ) : null}
                                {selectedBotWarnings.length > 0 ? (
                                  <div className="warning-list">
                                    {selectedBotWarnings.map((warning) => (
                                      <p
                                        className="message error"
                                        key={warning.senderBotId}
                                      >
                                        {warning.message}
                                      </p>
                                    ))}
                                  </div>
                                ) : null}
                              </>
                            ) : timerTrigger.senderMode === "all_bots" ? (
                              <p className="code">Sender pool: all active bots</p>
                            ) : (
                              <p className="code">
                                Sender pool: all active bots, one bot at a time.
                                Next sender index: {timerTrigger.nextSenderIndex}
                              </p>
                            )}
                          </div>
                          <div className="actions">
                            <button
                              className="button secondary"
                              type="button"
                              onClick={() => startEditingTimerTrigger(timerTrigger)}
                            >
                              Edit
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={timerTriggerSubmitting}
                              onClick={() => void handleToggleTimerTrigger(timerTrigger)}
                            >
                              {timerTrigger.enabled ? "Disable" : "Enable"}
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={timerTriggerSubmitting}
                              onClick={() => void handleDeleteTimerTrigger(timerTrigger.id)}
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

        <section className="card form-shell-span">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Timer Trigger Logs</h3>
                <p>Newest first. These logs are historical records.</p>
              </div>
              <div className="actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void handleClearTimerTriggerLogs()}
                >
                  Clear All Timer Logs
                </button>
              </div>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty">Loading timer trigger logs...</div>
            ) : timerTriggerLogs.length === 0 ? (
              <div className="empty">No timer trigger logs yet.</div>
            ) : (
              <div className="log-list">
                {timerTriggerLogs.map((log) => (
                  <article className="log-item" key={log.id}>
                    <h3>{log.timerTriggerName}</h3>
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
                      <span className="pill">
                        Scheduled for: {formatTime(log.scheduledFor)}
                      </span>
                      <span className="pill">
                        Executed at: {formatTime(log.executedAt)}
                      </span>
                    </div>
                    <p className="code">{log.message}</p>
                    {log.errorMessage ? (
                      <p className="code error-text">Error: {log.errorMessage}</p>
                    ) : null}
                    <div className="actions">
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => void handleDeleteTimerTriggerLog(log.id)}
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
