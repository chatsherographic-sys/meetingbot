import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseStorageConfigError } from "@/lib/storage/config";
import type { MatchSenderResult, StoreData } from "@/lib/types";
import type {
  StorageAdapter,
  StorageAdapterFactoryOptions,
} from "@/lib/storage/types";

const SETTINGS_ROW_ID = "app_settings";

type JsonRecord = Record<string, unknown>;

function createServiceRoleClient(): SupabaseClient {
  const configError = getSupabaseStorageConfigError();

  if (configError) {
    throw new Error(configError);
  }

  // Server-side storage must use the service role client only.
  // Do not swap this to an anon/publishable/browser Supabase client.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function normalizeJsonArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function normalizeSenderResults(value: unknown): MatchSenderResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const record = item && typeof item === "object" ? item : {};

    return {
      senderBotId:
        typeof (record as JsonRecord).senderBotId === "string"
          ? String((record as JsonRecord).senderBotId).trim()
          : null,
      senderBotName:
        typeof (record as JsonRecord).senderBotName === "string"
          ? String((record as JsonRecord).senderBotName).trim()
          : null,
      status:
        (record as JsonRecord).status === "sent" ||
        (record as JsonRecord).status === "failed" ||
        (record as JsonRecord).status === "no_active_sender_bot" ||
        (record as JsonRecord).status === "skipped_dedupe" ||
        (record as JsonRecord).status ===
          "skipped_duplicate_sender_execution"
          ? ((record as JsonRecord).status as MatchSenderResult["status"])
          : "dry_run",
      errorMessage:
        typeof (record as JsonRecord).errorMessage === "string"
          ? String((record as JsonRecord).errorMessage)
          : null,
      action: String((record as JsonRecord).action ?? "").trim(),
    };
  });
}

function mapStoreToRows(store: StoreData) {
  return {
    settings: [
      {
        id: SETTINGS_ROW_ID,
        storage_logging_mode: store.storageLoggingMode,
        live_chat_round_robin_index: store.liveChatRoundRobinIndex,
        updated_at: new Date().toISOString(),
      },
    ],
    meeting_sessions: store.meetingSessions.map((session) => ({
      id: session.id,
      name: session.name,
      zoom_url: session.zoomUrl,
      status: session.status,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      started_at: session.startedAt,
      ended_at: session.endedAt,
      notes: session.notes,
    })),
    recall_bots: store.recallBots.map((bot) => ({
      id: bot.id,
      session_id: bot.sessionId,
      recall_bot_id: bot.recallBotId,
      meeting_url: bot.meetingUrl,
      bot_name: bot.botName,
      transcript_language: bot.transcriptLanguage,
      webhook_url: bot.webhookUrl,
      status: bot.status,
      created_at: bot.createdAt,
      joined_at: bot.joinedAt,
      last_status_checked_at: bot.lastStatusCheckedAt,
      last_error_message: bot.lastErrorMessage,
      last_stop_attempt: bot.lastStopAttempt,
      create_request_payload: bot.createRequestPayload,
      raw_recall_response: bot.rawRecallResponse,
    })),
    scheduled_bot_joins: store.scheduledBotJoins.map((schedule) => ({
      id: schedule.id,
      session_id: schedule.sessionId,
      name: schedule.name,
      enabled: schedule.enabled,
      scheduled_at: schedule.scheduledAt,
      bot_count: schedule.botCount,
      bot_names: schedule.botNames,
      transcript_language: schedule.transcriptLanguage,
      status: schedule.status,
      created_bot_ids: schedule.createdBotIds,
      last_run_at: schedule.lastRunAt,
      error_message: schedule.errorMessage,
      created_at: schedule.createdAt,
      updated_at: schedule.updatedAt,
    })),
    trigger_rules: store.triggerRules.map((rule) => ({
      id: rule.id,
      session_id: rule.sessionId,
      trigger_phrase: rule.triggerPhrase,
      normalized_trigger: rule.normalizedTrigger,
      reply_message: rule.replyMessage,
      cooldown_seconds: rule.cooldownSeconds,
      response_delay_seconds: rule.responseDelaySeconds,
      sender_mode: rule.senderMode,
      sender_bot_ids: rule.senderBotIds,
      next_sender_index: rule.nextSenderIndex,
      trigger_count: rule.triggerCount,
      max_trigger_count: rule.maxTriggerCount,
      enabled: rule.enabled,
      last_matched_at: rule.lastMatchedAt,
      last_triggered_at: rule.lastTriggeredAt,
      created_at: rule.createdAt,
    })),
    timer_triggers: store.timerTriggers.map((trigger) => ({
      id: trigger.id,
      session_id: trigger.sessionId,
      name: trigger.name,
      enabled: trigger.enabled,
      delay_minutes_after_join: trigger.delayMinutesAfterJoin,
      message: trigger.message,
      sender_mode: trigger.senderMode,
      sender_bot_ids: trigger.senderBotIds,
      next_sender_index: trigger.nextSenderIndex,
      response_delay_seconds: trigger.responseDelaySeconds,
      max_trigger_count: trigger.maxTriggerCount,
      trigger_count: trigger.triggerCount,
      last_triggered_at: trigger.lastTriggeredAt,
      created_at: trigger.createdAt,
      updated_at: trigger.updatedAt,
    })),
    matched_trigger_logs: store.matchLogs.map((log) => ({
      id: log.id,
      session_id: log.sessionId,
      bot_id: log.botId,
      trigger_execution_id: log.triggerExecutionId,
      source_event: log.sourceEvent,
      source_webhook_bot_id: log.sourceWebhookBotId,
      rule_id: log.ruleId,
      trigger_phrase: log.triggerPhrase,
      reply_message: log.replyMessage,
      transcript_text: log.transcriptText,
      normalized_transcript_text: log.normalizedTranscriptText,
      created_at: log.createdAt,
      status: log.status,
      sender_mode: log.senderMode,
      sender_bot_ids_used: log.senderBotIdsUsed,
      original_sender_bot_ids: log.originalSenderBotIds,
      deduped_sender_bot_ids: log.dedupedSenderBotIds,
      chosen_round_robin_bot_id: log.chosenRoundRobinBotId,
      chosen_round_robin_bot_name: log.chosenRoundRobinBotName,
      previous_round_robin_index: log.previousRoundRobinIndex,
      next_round_robin_index: log.nextRoundRobinIndex,
      response_delay_seconds: log.responseDelaySeconds,
      trigger_count_after: log.triggerCountAfter,
      max_trigger_count: log.maxTriggerCount,
      auto_disabled_after_trigger: log.autoDisabledAfterTrigger,
      send_attempt_count: log.sendAttemptCount,
      actual_send_count: log.actualSendCount,
      warning_messages: log.warningMessages,
      sender_results: log.senderResults,
      error_message: log.errorMessage,
      action: log.action,
    })),
    timer_trigger_logs: store.timerTriggerLogs.map((log) => ({
      id: log.id,
      session_id: log.sessionId,
      timer_trigger_id: log.timerTriggerId,
      timer_trigger_name: log.timerTriggerName,
      scheduled_for: log.scheduledFor,
      executed_at: log.executedAt,
      message: log.message,
      sender_mode: log.senderMode,
      sender_bot_id_used: log.senderBotIdUsed,
      sender_bot_ids_used: log.senderBotIdsUsed,
      status: log.status,
      error_message: log.errorMessage,
    })),
    live_chat_logs: store.liveChatLogs.map((log) => ({
      id: log.id,
      session_id: log.sessionId,
      message: log.message,
      sender_mode: log.senderMode,
      sender_bot_ids_used: log.senderBotIdsUsed,
      sender_results: log.senderResults,
      status: log.status,
      created_at: log.createdAt,
      error_message: log.errorMessage,
    })),
    webhook_debug_logs: store.webhookDebugLogs.map((log) => ({
      id: log.id,
      session_id: log.sessionId,
      event_name: log.eventName,
      raw_payload: log.rawPayload,
      received_at: log.receivedAt,
      bot_id: log.botId,
      status: log.status,
      extracted_transcript_text: log.extractedTranscriptText,
      error_message: log.errorMessage,
    })),
    transcript_logs: store.transcriptLogs.map((log) => ({
      id: log.id,
      session_id: log.sessionId,
      bot_id: log.botId,
      transcript_text: log.transcriptText,
      normalized_transcript_text: log.normalizedTranscriptText,
      matched_rule_ids: log.matchedRuleIds,
      source_event: log.sourceEvent,
      created_at: log.createdAt,
    })),
  };
}

async function fetchAllTableData(client: SupabaseClient) {
  const [
    settingsResult,
    meetingSessionsResult,
    recallBotsResult,
    scheduledBotJoinsResult,
    triggerRulesResult,
    timerTriggersResult,
    matchedTriggerLogsResult,
    timerTriggerLogsResult,
    liveChatLogsResult,
    webhookDebugLogsResult,
    transcriptLogsResult,
  ] = await Promise.all([
    client.from("settings").select("*").eq("id", SETTINGS_ROW_ID).maybeSingle(),
    client.from("meeting_sessions").select("*"),
    client.from("recall_bots").select("*"),
    client.from("scheduled_bot_joins").select("*"),
    client.from("trigger_rules").select("*"),
    client.from("timer_triggers").select("*"),
    client.from("matched_trigger_logs").select("*"),
    client.from("timer_trigger_logs").select("*"),
    client.from("live_chat_logs").select("*"),
    client.from("webhook_debug_logs").select("*"),
    client.from("transcript_logs").select("*"),
  ]);

  const results = [
    settingsResult,
    meetingSessionsResult,
    recallBotsResult,
    scheduledBotJoinsResult,
    triggerRulesResult,
    timerTriggersResult,
    matchedTriggerLogsResult,
    timerTriggerLogsResult,
    liveChatLogsResult,
    webhookDebugLogsResult,
    transcriptLogsResult,
  ];

  const failedResult = results.find((result) => result.error);

  if (failedResult?.error) {
    throw new Error(failedResult.error.message);
  }

  return {
    settings: settingsResult.data,
    meetingSessions: meetingSessionsResult.data ?? [],
    recallBots: recallBotsResult.data ?? [],
    scheduledBotJoins: scheduledBotJoinsResult.data ?? [],
    triggerRules: triggerRulesResult.data ?? [],
    timerTriggers: timerTriggersResult.data ?? [],
    matchedTriggerLogs: matchedTriggerLogsResult.data ?? [],
    timerTriggerLogs: timerTriggerLogsResult.data ?? [],
    liveChatLogs: liveChatLogsResult.data ?? [],
    webhookDebugLogs: webhookDebugLogsResult.data ?? [],
    transcriptLogs: transcriptLogsResult.data ?? [],
  };
}

async function deleteMissingRows(
  client: SupabaseClient,
  tableName: string,
  rows: Array<{ id: string }>,
): Promise<void> {
  const { data, error } = await client.from(tableName).select("id");

  if (error) {
    throw new Error(error.message);
  }

  const nextIds = new Set(rows.map((row) => row.id));
  const staleIds = (data ?? [])
    .map((row) => String((row as { id: string }).id))
    .filter((id) => !nextIds.has(id));

  if (staleIds.length === 0) {
    return;
  }

  const { error: deleteError } = await client.from(tableName).delete().in("id", staleIds);

  if (deleteError) {
    throw new Error(deleteError.message);
  }
}

async function syncTable(
  client: SupabaseClient,
  tableName: string,
  rows: Array<{ id: string }>,
): Promise<void> {
  if (rows.length > 0) {
    const { error } = await client.from(tableName).upsert(rows, {
      onConflict: "id",
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  await deleteMissingRows(client, tableName, rows);
}

export function createSupabaseStoreAdapter(
  options: StorageAdapterFactoryOptions,
): StorageAdapter {
  return {
    driver: "supabase",
    async initialize() {
      createServiceRoleClient();
    },
    async readStore() {
      const client = createServiceRoleClient();
      const data = await fetchAllTableData(client);

      return options.normalizeStoreData({
        storageLoggingMode:
          data.settings?.storage_logging_mode ??
          options.emptyStore.storageLoggingMode,
        liveChatRoundRobinIndex:
          data.settings?.live_chat_round_robin_index ??
          options.emptyStore.liveChatRoundRobinIndex,
        meetingSessions: data.meetingSessions.map((session) => ({
          id: String(session.id),
          name: String(session.name ?? ""),
          zoomUrl: String(session.zoom_url ?? ""),
          status: String(session.status ?? "draft"),
          createdAt: String(session.created_at ?? new Date().toISOString()),
          updatedAt: String(session.updated_at ?? new Date().toISOString()),
          startedAt:
            typeof session.started_at === "string" ? session.started_at : null,
          endedAt:
            typeof session.ended_at === "string" ? session.ended_at : null,
          notes: String(session.notes ?? ""),
        })),
        recallBots: data.recallBots.map((bot) => ({
          id: String(bot.id),
          sessionId: String(bot.session_id ?? ""),
          recallBotId: String(bot.recall_bot_id ?? ""),
          meetingUrl: String(bot.meeting_url ?? ""),
          botName: String(bot.bot_name ?? ""),
          transcriptLanguage: String(bot.transcript_language ?? ""),
          webhookUrl: String(bot.webhook_url ?? ""),
          status: String(bot.status ?? "created"),
          createdAt: String(bot.created_at ?? new Date().toISOString()),
          joinedAt: typeof bot.joined_at === "string" ? bot.joined_at : null,
          lastStatusCheckedAt:
            typeof bot.last_status_checked_at === "string"
              ? bot.last_status_checked_at
              : null,
          lastErrorMessage:
            typeof bot.last_error_message === "string"
              ? bot.last_error_message
              : null,
          lastStopAttempt:
            bot.last_stop_attempt &&
            typeof bot.last_stop_attempt === "object" &&
            !Array.isArray(bot.last_stop_attempt)
              ? (bot.last_stop_attempt as StoreData["recallBots"][number]["lastStopAttempt"])
              : null,
          createRequestPayload:
            bot.create_request_payload &&
            typeof bot.create_request_payload === "object" &&
            !Array.isArray(bot.create_request_payload)
              ? (bot.create_request_payload as JsonRecord)
              : {},
          rawRecallResponse:
            bot.raw_recall_response &&
            typeof bot.raw_recall_response === "object" &&
            !Array.isArray(bot.raw_recall_response)
              ? (bot.raw_recall_response as JsonRecord)
              : {},
        })),
        scheduledBotJoins: data.scheduledBotJoins.map((schedule) => ({
          id: String(schedule.id),
          sessionId: String(schedule.session_id ?? ""),
          name: String(schedule.name ?? ""),
          enabled: Boolean(schedule.enabled),
          scheduledAt: String(schedule.scheduled_at ?? new Date().toISOString()),
          botCount: Number(schedule.bot_count ?? 1),
          botNames: normalizeJsonArray(schedule.bot_names),
          transcriptLanguage: String(schedule.transcript_language ?? "zh-CN"),
          status: String(schedule.status ?? "pending"),
          createdBotIds: normalizeJsonArray(schedule.created_bot_ids),
          lastRunAt:
            typeof schedule.last_run_at === "string"
              ? schedule.last_run_at
              : null,
          errorMessage:
            typeof schedule.error_message === "string"
              ? schedule.error_message
              : null,
          createdAt: String(schedule.created_at ?? new Date().toISOString()),
          updatedAt: String(schedule.updated_at ?? new Date().toISOString()),
        })),
        triggerRules: data.triggerRules.map((rule) => ({
          id: String(rule.id),
          sessionId: String(rule.session_id ?? ""),
          triggerPhrase: String(rule.trigger_phrase ?? ""),
          normalizedTrigger: String(rule.normalized_trigger ?? ""),
          replyMessage: String(rule.reply_message ?? ""),
          cooldownSeconds: Number(rule.cooldown_seconds ?? 0),
          responseDelaySeconds: Number(rule.response_delay_seconds ?? 0),
          senderMode: String(rule.sender_mode ?? "round_robin_bots"),
          senderBotIds: normalizeJsonArray(rule.sender_bot_ids),
          nextSenderIndex: Number(rule.next_sender_index ?? 0),
          triggerCount: Number(rule.trigger_count ?? 0),
          maxTriggerCount:
            rule.max_trigger_count === null || rule.max_trigger_count === undefined
              ? null
              : Number(rule.max_trigger_count),
          enabled: Boolean(rule.enabled),
          lastMatchedAt:
            typeof rule.last_matched_at === "string"
              ? rule.last_matched_at
              : null,
          lastTriggeredAt:
            typeof rule.last_triggered_at === "string"
              ? rule.last_triggered_at
              : null,
          createdAt: String(rule.created_at ?? new Date().toISOString()),
        })),
        timerTriggers: data.timerTriggers.map((trigger) => ({
          id: String(trigger.id),
          sessionId: String(trigger.session_id ?? ""),
          name: String(trigger.name ?? ""),
          enabled: Boolean(trigger.enabled),
          delayMinutesAfterJoin: Number(trigger.delay_minutes_after_join ?? 0),
          message: String(trigger.message ?? ""),
          senderMode: String(trigger.sender_mode ?? "round_robin_bots"),
          senderBotIds: normalizeJsonArray(trigger.sender_bot_ids),
          nextSenderIndex: Number(trigger.next_sender_index ?? 0),
          responseDelaySeconds: Number(trigger.response_delay_seconds ?? 0),
          maxTriggerCount:
            trigger.max_trigger_count === null ||
            trigger.max_trigger_count === undefined
              ? null
              : Number(trigger.max_trigger_count),
          triggerCount: Number(trigger.trigger_count ?? 0),
          lastTriggeredAt:
            typeof trigger.last_triggered_at === "string"
              ? trigger.last_triggered_at
              : null,
          createdAt: String(trigger.created_at ?? new Date().toISOString()),
          updatedAt: String(trigger.updated_at ?? new Date().toISOString()),
        })),
        matchLogs: data.matchedTriggerLogs.map((log) => ({
          id: String(log.id),
          sessionId: String(log.session_id ?? ""),
          botId: typeof log.bot_id === "string" ? log.bot_id : null,
          triggerExecutionId:
            typeof log.trigger_execution_id === "string"
              ? log.trigger_execution_id
              : null,
          sourceEvent:
            log.source_event === "transcript.partial_data"
              ? "transcript.partial_data"
              : "transcript.data",
          sourceWebhookBotId:
            typeof log.source_webhook_bot_id === "string"
              ? log.source_webhook_bot_id
              : null,
          ruleId: String(log.rule_id ?? ""),
          triggerPhrase: String(log.trigger_phrase ?? ""),
          replyMessage: String(log.reply_message ?? ""),
          transcriptText: String(log.transcript_text ?? ""),
          normalizedTranscriptText: String(log.normalized_transcript_text ?? ""),
          createdAt: String(log.created_at ?? new Date().toISOString()),
          status: String(log.status ?? "dry_run"),
          senderMode: String(log.sender_mode ?? "round_robin_bots"),
          senderBotIdsUsed: normalizeJsonArray(log.sender_bot_ids_used),
          originalSenderBotIds: normalizeJsonArray(log.original_sender_bot_ids),
          dedupedSenderBotIds: normalizeJsonArray(log.deduped_sender_bot_ids),
          chosenRoundRobinBotId:
            typeof log.chosen_round_robin_bot_id === "string"
              ? log.chosen_round_robin_bot_id
              : null,
          chosenRoundRobinBotName:
            typeof log.chosen_round_robin_bot_name === "string"
              ? log.chosen_round_robin_bot_name
              : null,
          previousRoundRobinIndex:
            log.previous_round_robin_index === null ||
            log.previous_round_robin_index === undefined
              ? null
              : Number(log.previous_round_robin_index),
          nextRoundRobinIndex:
            log.next_round_robin_index === null ||
            log.next_round_robin_index === undefined
              ? null
              : Number(log.next_round_robin_index),
          responseDelaySeconds: Number(log.response_delay_seconds ?? 0),
          triggerCountAfter:
            log.trigger_count_after === null ||
            log.trigger_count_after === undefined
              ? null
              : Number(log.trigger_count_after),
          maxTriggerCount:
            log.max_trigger_count === null || log.max_trigger_count === undefined
              ? null
              : Number(log.max_trigger_count),
          autoDisabledAfterTrigger: Boolean(log.auto_disabled_after_trigger),
          sendAttemptCount: Number(log.send_attempt_count ?? 0),
          actualSendCount: Number(log.actual_send_count ?? 0),
          warningMessages: normalizeJsonArray(log.warning_messages),
          senderResults: normalizeSenderResults(log.sender_results),
          errorMessage:
            typeof log.error_message === "string" ? log.error_message : null,
          action: String(log.action ?? ""),
        })),
        timerTriggerLogs: data.timerTriggerLogs.map((log) => ({
          id: String(log.id),
          sessionId: String(log.session_id ?? ""),
          timerTriggerId: String(log.timer_trigger_id ?? ""),
          timerTriggerName: String(log.timer_trigger_name ?? ""),
          scheduledFor: String(log.scheduled_for ?? new Date().toISOString()),
          executedAt: String(log.executed_at ?? new Date().toISOString()),
          message: String(log.message ?? ""),
          senderMode: String(log.sender_mode ?? "round_robin_bots"),
          senderBotIdUsed:
            typeof log.sender_bot_id_used === "string"
              ? log.sender_bot_id_used
              : null,
          senderBotIdsUsed: normalizeJsonArray(log.sender_bot_ids_used),
          status: String(log.status ?? "dry_run"),
          errorMessage:
            typeof log.error_message === "string" ? log.error_message : null,
        })),
        liveChatLogs: data.liveChatLogs.map((log) => ({
          id: String(log.id),
          sessionId: String(log.session_id ?? ""),
          message: String(log.message ?? ""),
          senderMode: String(log.sender_mode ?? "round_robin_bots"),
          senderBotIdsUsed: normalizeJsonArray(log.sender_bot_ids_used),
          senderResults: normalizeSenderResults(log.sender_results),
          status: String(log.status ?? "dry_run"),
          createdAt: String(log.created_at ?? new Date().toISOString()),
          errorMessage:
            typeof log.error_message === "string" ? log.error_message : null,
        })),
        webhookDebugLogs: data.webhookDebugLogs.map((log) => ({
          id: String(log.id),
          sessionId: String(log.session_id ?? ""),
          eventName: String(log.event_name ?? ""),
          rawPayload: log.raw_payload,
          receivedAt: String(log.received_at ?? new Date().toISOString()),
          botId: typeof log.bot_id === "string" ? log.bot_id : null,
          status: String(log.status ?? "unknown"),
          extractedTranscriptText:
            typeof log.extracted_transcript_text === "string"
              ? log.extracted_transcript_text
              : null,
          errorMessage:
            typeof log.error_message === "string" ? log.error_message : null,
        })),
        transcriptLogs: data.transcriptLogs.map((log) => ({
          id: String(log.id),
          sessionId: String(log.session_id ?? ""),
          botId: typeof log.bot_id === "string" ? log.bot_id : null,
          transcriptText: String(log.transcript_text ?? ""),
          normalizedTranscriptText: String(log.normalized_transcript_text ?? ""),
          matchedRuleIds: normalizeJsonArray(log.matched_rule_ids),
          sourceEvent:
            log.source_event === "transcript.partial_data"
              ? "transcript.partial_data"
              : "transcript.data",
          createdAt: String(log.created_at ?? new Date().toISOString()),
        })),
      });
    },
    async writeStore(data) {
      const client = createServiceRoleClient();
      const rows = mapStoreToRows(data);

      const { error: settingsError } = await client
        .from("settings")
        .upsert(rows.settings, { onConflict: "id" });

      if (settingsError) {
        throw new Error(settingsError.message);
      }

      await syncTable(client, "meeting_sessions", rows.meeting_sessions);
      await syncTable(client, "recall_bots", rows.recall_bots);
      await syncTable(client, "scheduled_bot_joins", rows.scheduled_bot_joins);
      await syncTable(client, "trigger_rules", rows.trigger_rules);
      await syncTable(client, "timer_triggers", rows.timer_triggers);
      await syncTable(client, "matched_trigger_logs", rows.matched_trigger_logs);
      await syncTable(client, "timer_trigger_logs", rows.timer_trigger_logs);
      await syncTable(client, "live_chat_logs", rows.live_chat_logs);
      await syncTable(client, "webhook_debug_logs", rows.webhook_debug_logs);
      await syncTable(client, "transcript_logs", rows.transcript_logs);
    },
  };
}
