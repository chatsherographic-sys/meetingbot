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
import { normalizeTranscript } from "@/lib/normalize";
import { normalizeSlotAliasGroups } from "@/lib/trigger-aliases";
import type {
  RecallBotRecord,
  SenderMode,
  TriggerRule,
  TriggerSlotAliasGroup,
} from "@/lib/types";
import {
  buildQueryString,
  formatTime,
  readJsonResponse,
  type PanelMessage,
} from "@/components/control-panel-client";
import { useMeetingSession } from "@/components/meeting-session-context";
import { getSessionOperationBlockedMessage } from "@/lib/session-operations";

type TriggerRuleFormState = {
  triggerPhrase: string;
  slotAliasGroups: TriggerSlotAliasGroup[];
  replyMessage: string;
  cooldownSeconds: string;
  responseDelaySeconds: string;
  senderMode: SenderMode;
  senderBotIds: string[];
  maxTriggerCount: string;
};

type SelectedBotWarning = {
  senderBotId: string;
  message: string;
};

type RoundRobinPreview = {
  botId: string | null;
  botName: string | null;
  index: number | null;
  message: string | null;
};

function getAliasSuggestionSuccessText(slotGroupCount: number): string {
  if (slotGroupCount > 0) {
    return `Loaded ${slotGroupCount} slot alias group(s). Review and save when ready.`;
  }

  return "No slot alias groups were suggested for the current trigger phrase.";
}

const initialRuleForm: TriggerRuleFormState = {
  triggerPhrase: "",
  slotAliasGroups: [],
  replyMessage: "",
  cooldownSeconds: "30",
  responseDelaySeconds: "0",
  senderMode: "round_robin_bots",
  senderBotIds: [],
  maxTriggerCount: "",
};

export function TriggersPageClient() {
  const { currentSession, currentSessionId, loading: sessionLoading } =
    useMeetingSession();
  const [rules, setRules] = useState<TriggerRule[]>([]);
  const [recallBots, setRecallBots] = useState<RecallBotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ruleSubmitting, setRuleSubmitting] = useState(false);
  const [aliasSuggestionLoadingTargets, setAliasSuggestionLoadingTargets] =
    useState<Record<string, boolean>>({});
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleMessage, setRuleMessage] = useState<PanelMessage>(null);
  const [triggerSearch, setTriggerSearch] = useState("");
  const [replySearch, setReplySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [ruleForm, setRuleForm] = useState<TriggerRuleFormState>(initialRuleForm);
  const [editingRuleForm, setEditingRuleForm] =
    useState<TriggerRuleFormState>(initialRuleForm);
  const latestNormalizedTriggerRef = useRef<Record<string, string>>({
    create: "",
  });
  const latestAliasRequestIdRef = useRef(0);
  const latestAliasRequestByTargetRef = useRef<Record<string, number>>({});

  const activeBots = useMemo(
    () => recallBots.filter((bot) => isBotActiveStatus(bot.status)),
    [recallBots],
  );
  const currentSessionBlockedMessage = getSessionOperationBlockedMessage(
    currentSession?.status,
  );

  async function loadRules() {
    const [rulesResponse, botsResponse] = await Promise.all([
      fetch(
        `/api/trigger-rules${buildQueryString({
          sessionId: currentSessionId,
          triggerSearch,
          replySearch,
          status: statusFilter,
        })}`,
        { cache: "no-store" },
      ),
      fetch(
        `/api/recall/bots${buildQueryString({
          pageSize: 200,
          sessionId: currentSessionId,
        })}`,
        { cache: "no-store" },
      ),
    ]);

    if (!rulesResponse.ok || !botsResponse.ok) {
      throw new Error("Failed to load trigger rules.");
    }

    const rulesPayload = await readJsonResponse<{
      triggerRules: TriggerRule[];
    }>(rulesResponse);
    const botsPayload = await readJsonResponse<{
      recallBots: RecallBotRecord[];
    }>(botsResponse);

    setRules(rulesPayload.triggerRules);
    setRecallBots(botsPayload.recallBots);
    setError(null);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        await loadRules();
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load trigger rules.",
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
  }, [triggerSearch, replySearch, statusFilter, currentSessionId]);

  function startEditingRule(rule: TriggerRule) {
    latestNormalizedTriggerRef.current[rule.id] = normalizeTranscript(
      rule.triggerPhrase,
    );
    setEditingRuleId(rule.id);
    setEditingRuleForm({
      triggerPhrase: rule.triggerPhrase,
      slotAliasGroups: rule.slotAliasGroups,
      replyMessage: rule.replyMessage,
      cooldownSeconds: String(rule.cooldownSeconds),
      responseDelaySeconds: String(rule.responseDelaySeconds),
      senderMode: rule.senderMode,
      senderBotIds: rule.senderBotIds,
      maxTriggerCount: rule.maxTriggerCount ? String(rule.maxTriggerCount) : "",
    });
    setRuleMessage(null);
  }

  function cancelEditingRule() {
    if (editingRuleId) {
      delete latestNormalizedTriggerRef.current[editingRuleId];
      delete latestAliasRequestByTargetRef.current[editingRuleId];
    }
    setEditingRuleId(null);
    setRuleMessage(null);
  }

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

  function getRoundRobinPreview(nextSenderIndex: number): RoundRobinPreview {
    if (activeBots.length === 0) {
      return {
        botId: null,
        botName: null,
        index: null,
        message: "No active bots are currently available for round-robin mode.",
      };
    }

    const normalizedIndex =
      activeBots.length > 0
        ? Math.max(0, Math.floor(nextSenderIndex)) % activeBots.length
        : 0;
    const senderBot = activeBots[normalizedIndex];

    return {
      botId: senderBot.recallBotId,
      botName: senderBot.botName,
      index: normalizedIndex,
      message: null,
    };
  }

  function toggleSenderBot(
    setter: Dispatch<SetStateAction<TriggerRuleFormState>>,
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
    setter: Dispatch<SetStateAction<TriggerRuleFormState>>,
    senderBotId: string,
  ) {
    setter((current) => ({
      ...current,
      senderBotIds: current.senderBotIds.filter((botId) => botId !== senderBotId),
    }));
  }

  function updateTriggerPhraseState(
    setter: Dispatch<SetStateAction<TriggerRuleFormState>>,
    target: string,
    nextTriggerPhrase: string,
  ) {
    setter((current) => {
      const currentNormalizedTrigger = normalizeTranscript(current.triggerPhrase);
      const nextNormalizedTrigger = normalizeTranscript(nextTriggerPhrase);
      const triggerChanged = currentNormalizedTrigger !== nextNormalizedTrigger;
      latestNormalizedTriggerRef.current[target] = nextNormalizedTrigger;

      if (!triggerChanged) {
        return {
          ...current,
          triggerPhrase: nextTriggerPhrase,
        };
      }

      return {
        ...current,
        triggerPhrase: nextTriggerPhrase,
        slotAliasGroups: [],
      };
    });
  }

  async function handleSuggestAliases(options: {
    target: "create" | string;
    triggerPhrase: string;
    setter: Dispatch<SetStateAction<TriggerRuleFormState>>;
  }) {
    const trimmedTriggerPhrase = options.triggerPhrase.trim();
    const requestedNormalizedTrigger = normalizeTranscript(trimmedTriggerPhrase);
    const requestId = latestAliasRequestIdRef.current + 1;
    latestAliasRequestIdRef.current = requestId;
    latestAliasRequestByTargetRef.current[options.target] = requestId;

    if (!trimmedTriggerPhrase) {
      setRuleMessage({
        type: "error",
        text: "Enter a trigger phrase before requesting alias suggestions.",
      });
      return;
    }

    setAliasSuggestionLoadingTargets((current) => ({
      ...current,
      [options.target]: true,
    }));
    setRuleMessage(null);

    try {
      const response = await fetch("/api/trigger-rules/suggest-aliases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          triggerPhrase: trimmedTriggerPhrase,
        }),
      });
      const payload = await readJsonResponse<{
        slotAliasGroups?: TriggerSlotAliasGroup[];
        error?: string;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to suggest aliases.");
      }

      if (
        latestAliasRequestByTargetRef.current[options.target] !== requestId
      ) {
        return;
      }

      if (
        latestNormalizedTriggerRef.current[options.target] !==
        requestedNormalizedTrigger
      ) {
        setRuleMessage({
          type: "error",
          text: "Trigger phrase changed before alias suggestions returned. Please click Suggest Aliases again.",
        });
        return;
      }

      options.setter((current) => {
        return {
          ...current,
          slotAliasGroups: normalizeSlotAliasGroups(
            current.triggerPhrase,
            Array.isArray(payload.slotAliasGroups) ? payload.slotAliasGroups : [],
          ),
        };
      });
      setRuleMessage({
        type: "success",
        text: getAliasSuggestionSuccessText(
          Array.isArray(payload.slotAliasGroups)
            ? payload.slotAliasGroups.length
            : 0,
        ),
      });
    } catch (error) {
      if (
        latestAliasRequestByTargetRef.current[options.target] !== requestId
      ) {
        return;
      }

      setRuleMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to suggest aliases.",
      });
    } finally {
      if (latestAliasRequestByTargetRef.current[options.target] === requestId) {
        setAliasSuggestionLoadingTargets((current) => ({
          ...current,
          [options.target]: false,
        }));
      }
    }
  }

  async function handleTriggerRuleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRuleSubmitting(true);
    setRuleMessage(null);

    try {
      const response = await fetch("/api/trigger-rules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: currentSessionId,
          triggerPhrase: ruleForm.triggerPhrase,
          aliases: [],
          slotAliasGroups: normalizeSlotAliasGroups(
            ruleForm.triggerPhrase,
            ruleForm.slotAliasGroups,
          ),
          replyMessage: ruleForm.replyMessage,
          cooldownSeconds: Number(ruleForm.cooldownSeconds),
          responseDelaySeconds: Number(ruleForm.responseDelaySeconds),
          senderMode: ruleForm.senderMode,
          senderBotIds:
            ruleForm.senderMode === "specific_bots" ? ruleForm.senderBotIds : [],
          maxTriggerCount:
            ruleForm.maxTriggerCount.trim() === ""
              ? null
              : Number(ruleForm.maxTriggerCount),
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create trigger rule.");
      }

      setRuleForm(initialRuleForm);
      setRuleMessage({
        type: "success",
        text: "Trigger rule created.",
      });
      await loadRules();
    } catch (createError) {
      setRuleMessage({
        type: "error",
        text:
          createError instanceof Error
            ? createError.message
            : "Failed to create trigger rule.",
      });
    } finally {
      setRuleSubmitting(false);
    }
  }

  async function handleSaveRule(ruleId: string) {
    setRuleSubmitting(true);
    setRuleMessage(null);

    try {
      const response = await fetch(`/api/trigger-rules/${ruleId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          triggerPhrase: editingRuleForm.triggerPhrase,
          aliases: [],
          slotAliasGroups: normalizeSlotAliasGroups(
            editingRuleForm.triggerPhrase,
            editingRuleForm.slotAliasGroups,
          ),
          replyMessage: editingRuleForm.replyMessage,
          cooldownSeconds: Number(editingRuleForm.cooldownSeconds),
          responseDelaySeconds: Number(editingRuleForm.responseDelaySeconds),
          senderMode: editingRuleForm.senderMode,
          senderBotIds:
            editingRuleForm.senderMode === "specific_bots"
              ? editingRuleForm.senderBotIds
              : [],
          maxTriggerCount:
            editingRuleForm.maxTriggerCount.trim() === ""
              ? null
              : Number(editingRuleForm.maxTriggerCount),
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update trigger rule.");
      }

      setRuleMessage({
        type: "success",
        text: "Trigger rule updated.",
      });
      setEditingRuleId(null);
      await loadRules();
    } catch (saveError) {
      setRuleMessage({
        type: "error",
        text:
          saveError instanceof Error
            ? saveError.message
            : "Failed to update trigger rule.",
      });
    } finally {
      setRuleSubmitting(false);
    }
  }

  async function handleToggleRule(rule: TriggerRule) {
    setRuleSubmitting(true);
    setRuleMessage(null);

    try {
      const response = await fetch(`/api/trigger-rules/${rule.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: !rule.enabled,
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update trigger rule.");
      }

      setRuleMessage({
        type: "success",
        text: rule.enabled ? "Trigger rule disabled." : "Trigger rule enabled.",
      });
      await loadRules();
    } catch (toggleError) {
      setRuleMessage({
        type: "error",
        text:
          toggleError instanceof Error
            ? toggleError.message
            : "Failed to update trigger rule.",
      });
    } finally {
      setRuleSubmitting(false);
    }
  }

  async function handleDeleteRule(ruleId: string) {
    setRuleSubmitting(true);
    setRuleMessage(null);

    try {
      const response = await fetch(`/api/trigger-rules/${ruleId}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete trigger rule.");
      }

      if (editingRuleId === ruleId) {
        setEditingRuleId(null);
      }

      setRuleMessage({
        type: "success",
        text: "Trigger rule deleted.",
      });
      await loadRules();
    } catch (deleteError) {
      setRuleMessage({
        type: "error",
        text:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete trigger rule.",
      });
    } finally {
      setRuleSubmitting(false);
    }
  }

  async function handleDeleteAllRules() {
    const confirmed = window.confirm(
      "This will delete all trigger rules for the current session only. This cannot be undone.",
    );

    if (!confirmed) {
      return;
    }

    setRuleSubmitting(true);
    setRuleMessage(null);

    try {
      const response = await fetch(
        `/api/trigger-rules${buildQueryString({ sessionId: currentSessionId })}`,
        {
          method: "DELETE",
        },
      );
      const payload = await readJsonResponse<{
        error?: string;
        removedCount?: number;
      }>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete trigger rules.");
      }

      if (editingRuleId) {
        setEditingRuleId(null);
      }

      setRuleMessage({
        type: "success",
        text: `Deleted ${payload.removedCount ?? 0} trigger rule(s) for the current session.`,
      });
      await loadRules();
    } catch (deleteError) {
      setRuleMessage({
        type: "error",
        text:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete trigger rules.",
      });
    } finally {
      setRuleSubmitting(false);
    }
  }

  function renderSenderBotSelector(
    formState: TriggerRuleFormState,
    setter: Dispatch<SetStateAction<TriggerRuleFormState>>,
    idPrefix: string,
    currentNextSenderIndex = 0,
  ) {
    const unavailableSelectedBots = getUnavailableSelectedBots(
      formState.senderBotIds,
    );
    const selectedActiveBots = activeBots.filter((bot) =>
      formState.senderBotIds.includes(bot.recallBotId),
    );
    const roundRobinPreview = getRoundRobinPreview(currentNextSenderIndex);

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
                senderMode: event.target.value as SenderMode,
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
              Round-robin automatically uses all currently Active Bots and sends
              from one bot at a time.
            </p>
          ) : null}
          {formState.senderMode === "all_bots" ? (
            <p className="muted">
              All active bots will send this reply once each.
            </p>
          ) : null}
        </div>

        {formState.senderMode === "round_robin_bots" ||
        formState.senderMode === "all_bots" ? (
          <div className="field">
            <label>
              {formState.senderMode === "round_robin_bots"
                ? "Round-robin active bot pool"
                : "All-bots active bot pool"}
            </label>
            {activeBots.length === 0 ? (
              <div className="empty">No active bots right now.</div>
            ) : (
              <div className="choice-stack">
                <div className="choice-group">
                  <p className="choice-title">Active / In Meeting Bots</p>
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
                </div>
              </div>
            )}
            {formState.senderMode === "round_robin_bots" &&
            roundRobinPreview.botId &&
            roundRobinPreview.botName ? (
              <p className="code">
                Next sender preview: {roundRobinPreview.botName} (
                {roundRobinPreview.botId}) at index {roundRobinPreview.index}
              </p>
            ) : formState.senderMode === "round_robin_bots" &&
              roundRobinPreview.message ? (
              <p className="message error">{roundRobinPreview.message}</p>
            ) : null}
          </div>
        ) : null}

        {formState.senderMode === "specific_bots" ? (
          <div className="field">
            <label>Specific sender bot(s)</label>
            {recallBots.length === 0 ? (
              <div className="empty">No saved bots yet. Create a bot first.</div>
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
                No bots assigned yet. This trigger will not send until bots are
                assigned.
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
        ) : null}
      </>
    );
  }

  const createSlotAliasGroupsPreview = normalizeSlotAliasGroups(
    ruleForm.triggerPhrase,
    ruleForm.slotAliasGroups,
  );
  const editingSlotAliasGroupsPreview = normalizeSlotAliasGroups(
    editingRuleForm.triggerPhrase,
    editingRuleForm.slotAliasGroups,
  );

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Triggers</p>
          <h2>Manage trigger rules</h2>
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
      {ruleMessage ? (
        <p className={`message ${ruleMessage.type}`}>{ruleMessage.text}</p>
      ) : null}

      <div className="form-shell">
        <section className="card">
          <div className="card-header">
            <h3>Create Trigger Rule</h3>
            <p>
              Add a phrase, reply message, cooldown window, and choose which bot
              should send the Zoom chat.
            </p>
          </div>
          <div className="card-body">
            <form className="form" onSubmit={handleTriggerRuleSubmit}>
              <div className="field">
                <label htmlFor="triggerPhrase">Trigger phrase</label>
                <input
                  id="triggerPhrase"
                  value={ruleForm.triggerPhrase}
                  onChange={(event) =>
                    updateTriggerPhraseState(
                      setRuleForm,
                      "create",
                      event.target.value,
                    )
                  }
                  placeholder="e.g. test123"
                  required
                />
              </div>

              <div className="field">
                <div className="section-row">
                  <label>Slot Alias Groups</label>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={
                      ruleSubmitting ||
                      Boolean(aliasSuggestionLoadingTargets.create)
                    }
                    onClick={() =>
                      void handleSuggestAliases({
                        target: "create",
                        triggerPhrase: ruleForm.triggerPhrase,
                        setter: setRuleForm,
                      })
                    }
                  >
                    {aliasSuggestionLoadingTargets.create
                      ? "Suggesting..."
                      : "Suggest Aliases"}
                  </button>
                </div>
                <p className="muted">
                  Auto-generated Chinese ASR matching by position. When the
                  trigger phrase changes, old slot alias groups are cleared and
                  you should click Suggest Aliases again before saving.
                </p>
                <div className="code-block">
                  <p className="code">Slot Alias Groups preview:</p>
                  {createSlotAliasGroupsPreview.length > 0 ? (
                    createSlotAliasGroupsPreview.map((group) => (
                      <p className="code" key={`create-${group.source}`}>
                        {group.source}: {group.aliases.join(", ")}
                      </p>
                    ))
                  ) : (
                    <p className="code">(none)</p>
                  )}
                </div>
              </div>

              <div className="field">
                <label htmlFor="replyMessage">Reply message</label>
                <textarea
                  id="replyMessage"
                  value={ruleForm.replyMessage}
                  onChange={(event) =>
                    setRuleForm((current) => ({
                      ...current,
                      replyMessage: event.target.value,
                    }))
                  }
                  placeholder="Thanks, I heard that trigger."
                  required
                />
              </div>

              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor="cooldownSeconds">Cooldown seconds</label>
                  <input
                    id="cooldownSeconds"
                    type="number"
                    min="0"
                    step="1"
                    value={ruleForm.cooldownSeconds}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        cooldownSeconds: event.target.value,
                      }))
                    }
                    required
                  />
                </div>

                <div className="field">
                  <label htmlFor="responseDelaySeconds">Response Delay Seconds</label>
                  <input
                    id="responseDelaySeconds"
                    type="number"
                    min="0"
                    max="300"
                    step="1"
                    value={ruleForm.responseDelaySeconds}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        responseDelaySeconds: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="maxTriggerCount">Max Trigger Count</label>
                <input
                  id="maxTriggerCount"
                  type="number"
                  min="0"
                  step="1"
                  value={ruleForm.maxTriggerCount}
                  onChange={(event) =>
                    setRuleForm((current) => ({
                      ...current,
                      maxTriggerCount: event.target.value,
                    }))
                  }
                  placeholder="0"
                />
                <p className="muted">Empty or 0 = unlimited</p>
              </div>

              {renderSenderBotSelector(ruleForm, setRuleForm, "create", 0)}

              <div className="field">
                <label htmlFor="normalizedPreview">Normalized preview</label>
                <input
                  id="normalizedPreview"
                  value={normalizeTranscript(ruleForm.triggerPhrase)}
                  readOnly
                />
              </div>

              <div className="actions">
                <button className="button" type="submit" disabled={ruleSubmitting}>
                  {ruleSubmitting ? "Saving..." : "Create rule"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void loadRules()}
                >
                  Refresh data
                </button>
              </div>
            </form>
          </div>
        </section>

        <div className="side-stack">
          <section className="card">
            <div className="card-header">
              <h3>Current Session</h3>
              <p>Triggers only match transcripts from bots in this session.</p>
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
                  <span className="setting-label">Active Bots</span>
                  <span className="setting-value">{activeBots.length}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h3>Sender Mode Help</h3>
            </div>
            <div className="card-body">
              <ul className="helper-list">
                <li>Round-robin uses all active bots and rotates one sender at a time.</li>
                <li>Specific bots sends from the selected active bots only.</li>
                <li>All bots sends the same reply once from every active bot.</li>
              </ul>
              {activeBots.length === 0 ? (
                <p className="message warning">
                  No active bots are available right now. Rules can still be saved.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="card form-shell-span">
          <div className="card-header">
            <div className="section-row">
              <div>
                <h3>Trigger Rules</h3>
                <p>
                  Existing duplicate rules still load so you can disable or delete
                  them manually.
                </p>
              </div>
              <div className="actions">
                <button
                  className="button secondary"
                  type="button"
                  disabled={
                    ruleSubmitting ||
                    rules.length === 0 ||
                    Boolean(currentSessionBlockedMessage)
                  }
                  onClick={() => void handleDeleteAllRules()}
                >
                  Delete All Trigger Rules
                </button>
              </div>
            </div>
          </div>
          <div className="card-body">
            <div className="filters-grid">
              <div className="field">
                <label htmlFor="trigger-search">Search trigger phrase</label>
                <input
                  id="trigger-search"
                  value={triggerSearch}
                  onChange={(event) => setTriggerSearch(event.target.value)}
                  placeholder="test123"
                />
              </div>
              <div className="field">
                <label htmlFor="reply-search">Search reply message</label>
                <input
                  id="reply-search"
                  value={replySearch}
                  onChange={(event) => setReplySearch(event.target.value)}
                  placeholder="Thanks, I heard that trigger."
                />
              </div>
              <div className="field">
                <label htmlFor="trigger-status-filter">Filter status</label>
                <select
                  id="trigger-status-filter"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">All rules</option>
                  <option value="enabled">enabled</option>
                  <option value="disabled">disabled</option>
                </select>
              </div>
            </div>
            {loading ? (
              <div className="empty">Loading trigger rules...</div>
            ) : rules.length === 0 ? (
              <div className="empty">No trigger rules yet.</div>
            ) : (
              <div className="rule-list">
                {rules.map((rule) => {
                  const isEditing = editingRuleId === rule.id;
                  const selectedBotSummaries = getSelectedBotSummaries(
                    rule.senderBotIds,
                  );
                  const selectedBotWarnings = getUnavailableSelectedBots(
                    rule.senderBotIds,
                  );
                  const wasAutoDisabled =
                    !rule.enabled &&
                    rule.maxTriggerCount !== null &&
                    rule.triggerCount >= rule.maxTriggerCount;

                  return (
                    <article className="rule-item" key={rule.id}>
                      {isEditing ? (
                        <div className="form">
                          <div className="field">
                            <label htmlFor={`edit-trigger-${rule.id}`}>
                              Trigger phrase
                            </label>
                            <input
                              id={`edit-trigger-${rule.id}`}
                              value={editingRuleForm.triggerPhrase}
                              onChange={(event) =>
                                updateTriggerPhraseState(
                                  setEditingRuleForm,
                                  rule.id,
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                          <div className="field">
                            <div className="section-row">
                              <label>Slot Alias Groups</label>
                              <button
                                className="button secondary"
                                type="button"
                                disabled={
                                  ruleSubmitting ||
                                  Boolean(aliasSuggestionLoadingTargets[rule.id])
                                }
                                onClick={() =>
                                  void handleSuggestAliases({
                                    target: rule.id,
                                    triggerPhrase: editingRuleForm.triggerPhrase,
                                    setter: setEditingRuleForm,
                                  })
                                }
                              >
                                {aliasSuggestionLoadingTargets[rule.id]
                                  ? "Suggesting..."
                                  : "Suggest Aliases"}
                              </button>
                            </div>
                            <p className="muted">
                              Auto-generated Chinese ASR matching by position.
                              When the trigger phrase changes, old slot alias
                              groups are cleared and you should click Suggest
                              Aliases again before saving.
                            </p>
                            <div className="code-block">
                              <p className="code">Slot Alias Groups preview:</p>
                              {editingSlotAliasGroupsPreview.length > 0 ? (
                                editingSlotAliasGroupsPreview.map((group) => (
                                  <p className="code" key={`${rule.id}-${group.source}`}>
                                    {group.source}: {group.aliases.join(", ")}
                                  </p>
                                ))
                              ) : (
                                <p className="code">(none)</p>
                              )}
                            </div>
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-reply-${rule.id}`}>
                              Reply message
                            </label>
                            <textarea
                              id={`edit-reply-${rule.id}`}
                              value={editingRuleForm.replyMessage}
                              onChange={(event) =>
                                setEditingRuleForm((current) => ({
                                  ...current,
                                  replyMessage: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-cooldown-${rule.id}`}>
                              Cooldown seconds
                            </label>
                            <input
                              id={`edit-cooldown-${rule.id}`}
                              type="number"
                              min="0"
                              step="1"
                              value={editingRuleForm.cooldownSeconds}
                              onChange={(event) =>
                                setEditingRuleForm((current) => ({
                                  ...current,
                                  cooldownSeconds: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-delay-${rule.id}`}>
                              Response Delay Seconds
                            </label>
                            <input
                              id={`edit-delay-${rule.id}`}
                              type="number"
                              min="0"
                              max="300"
                              step="1"
                              value={editingRuleForm.responseDelaySeconds}
                              onChange={(event) =>
                                setEditingRuleForm((current) => ({
                                  ...current,
                                  responseDelaySeconds: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-max-trigger-${rule.id}`}>
                              Max Trigger Count
                            </label>
                            <input
                              id={`edit-max-trigger-${rule.id}`}
                              type="number"
                              min="0"
                              step="1"
                              value={editingRuleForm.maxTriggerCount}
                              onChange={(event) =>
                                setEditingRuleForm((current) => ({
                                  ...current,
                                  maxTriggerCount: event.target.value,
                                }))
                              }
                              placeholder="0"
                            />
                            <p className="muted">Empty or 0 = unlimited</p>
                          </div>

                          {renderSenderBotSelector(
                            editingRuleForm,
                            setEditingRuleForm,
                            `edit-${rule.id}`,
                            rule.nextSenderIndex,
                          )}

                          <div className="field">
                            <label htmlFor={`edit-normalized-preview-${rule.id}`}>
                              Normalized preview
                            </label>
                            <input
                              id={`edit-normalized-preview-${rule.id}`}
                              value={normalizeTranscript(
                                editingRuleForm.triggerPhrase,
                              )}
                              readOnly
                            />
                          </div>
                          <div className="actions">
                            <button
                              className="button"
                              type="button"
                              disabled={ruleSubmitting}
                              onClick={() => void handleSaveRule(rule.id)}
                            >
                              {ruleSubmitting ? "Saving..." : "Save"}
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              onClick={cancelEditingRule}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <h3>{rule.triggerPhrase}</h3>
                          <p className="muted">Normalized: {rule.normalizedTrigger}</p>
                          <div className="code-block">
                            <p className="code">Slot Alias Groups preview:</p>
                            {rule.slotAliasGroups.length > 0 ? (
                              rule.slotAliasGroups.map((group) => (
                                <p className="code" key={`${rule.id}-${group.source}`}>
                                  {group.source}: {group.aliases.join(", ")}
                                </p>
                              ))
                            ) : (
                              <p className="code">(none)</p>
                            )}
                          </div>
                          <p className="muted">{rule.replyMessage}</p>
                          <div className="rule-meta">
                            <span className="pill">
                              Cooldown: {rule.cooldownSeconds}s
                            </span>
                            <span className="pill">
                              Delay: {rule.responseDelaySeconds}s
                            </span>
                            <span
                              className={`pill status-${
                                rule.enabled ? "sent" : "unknown"
                              }`}
                            >
                              {rule.enabled ? "enabled" : "disabled"}
                            </span>
                            {wasAutoDisabled ? (
                              <span className="pill status-failed">
                                Auto-disabled at limit
                              </span>
                            ) : null}
                            <span className="pill">
                              Sender mode: {rule.senderMode}
                            </span>
                            {rule.senderMode === "round_robin_bots" ? (
                              <span className="pill">
                                Next sender index: {rule.nextSenderIndex}
                              </span>
                            ) : null}
                            <span className="pill">
                              Usage: {rule.triggerCount} /{" "}
                              {rule.maxTriggerCount ?? "unlimited"}
                            </span>
                            <span className="pill">
                              Last match:{" "}
                              {rule.lastMatchedAt
                                ? formatTime(rule.lastMatchedAt)
                                : "Never"}
                            </span>
                            <span className="pill">
                              Last triggered:{" "}
                              {rule.lastTriggeredAt
                                ? formatTime(rule.lastTriggeredAt)
                                : "Never"}
                            </span>
                          </div>
                          <div className="code-block">
                            {rule.senderMode === "round_robin_bots" ? (
                              <>
                                <p className="code">Sender pool: all active bots</p>
                                {(() => {
                                  const roundRobinPreview = getRoundRobinPreview(
                                    rule.nextSenderIndex,
                                  );

                                  return roundRobinPreview.botId &&
                                    roundRobinPreview.botName ? (
                                    <p className="code">
                                      Current next sender: {roundRobinPreview.botName} (
                                      {roundRobinPreview.botId}) at index{" "}
                                      {roundRobinPreview.index}
                                    </p>
                                  ) : roundRobinPreview.message ? (
                                    <p className="message error">
                                      {roundRobinPreview.message}
                                    </p>
                                  ) : null;
                                })()}
                              </>
                            ) : rule.senderMode === "all_bots" ? (
                              <p className="code">
                                Sender pool: all active bots. Every active bot
                                sends this reply once per accepted trigger.
                              </p>
                            ) : (
                              <>
                                <p className="code">
                                  Sender bots:{" "}
                                  {selectedBotSummaries.length > 0
                                    ? selectedBotSummaries.join(", ")
                                    : "None selected"}
                                </p>
                                {selectedBotSummaries.length === 0 ? (
                                  <p className="message error">
                                    No bots assigned yet. This trigger will not
                                    send until bots are assigned.
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
                            )}
                          </div>
                          {wasAutoDisabled ? (
                            <p className="message error">
                              This rule auto-disabled after reaching its max
                              trigger count.
                            </p>
                          ) : null}
                          <div className="actions">
                            <button
                              className="button secondary"
                              type="button"
                              onClick={() => startEditingRule(rule)}
                            >
                              Edit
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={ruleSubmitting}
                              onClick={() => void handleToggleRule(rule)}
                            >
                              {rule.enabled ? "Disable" : "Enable"}
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={ruleSubmitting}
                              onClick={() => void handleDeleteRule(rule.id)}
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

