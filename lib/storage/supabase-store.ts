import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseStorageConfigError } from "@/lib/storage/config";
import type { MatchLog, MatchSenderResult, StoreData } from "@/lib/types";
import type {
  StorageAdapter,
  StorageAdapterFactoryOptions,
} from "@/lib/storage/types";

const SETTINGS_ROW_ID = "app_settings";

type JsonRecord = Record<string, unknown>;

export function createSupabaseServiceRoleClient(): SupabaseClient {
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
      role: bot.role,
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
      aliases: rule.aliases,
      normalized_aliases: rule.normalizedAliases,
      slot_alias_groups: rule.slotAliasGroups,
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
      match_type: log.matchType,
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
      latency_diagnostics: log.latencyDiagnostics,
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
    live_chat_templates: store.liveChatTemplates.map((template) => ({
      id: template.id,
      session_id: template.sessionId,
      name: template.name,
      message: template.message,
      sender_mode: template.senderMode,
      bot_ids: template.botIds,
      round_robin_index: template.roundRobinIndex,
      last_sent_bot_id: template.lastSentBotId,
      last_sent_at: template.lastSentAt,
      created_at: template.createdAt,
      updated_at: template.updatedAt,
    })),
  };
}

async function fetchAllTableData(client: SupabaseClient) {
  const [
    settingsResult,
    meetingSessionsResult,
    recallBotsResult,
    scheduledBotJoinsResult,
    liveChatLogsResult,
    liveChatTemplatesResult,
  ] = await Promise.all([
    client.from("settings").select("*").eq("id", SETTINGS_ROW_ID).maybeSingle(),
    client.from("meeting_sessions").select("*"),
    client.from("recall_bots").select("*"),
    client.from("scheduled_bot_joins").select("*"),
    client.from("live_chat_logs").select("*"),
    client.from("live_chat_templates").select("*"),
  ]);

  const results = [
    settingsResult,
    meetingSessionsResult,
    recallBotsResult,
    scheduledBotJoinsResult,
    liveChatLogsResult,
    liveChatTemplatesResult,
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
    liveChatLogs: liveChatLogsResult.data ?? [],
    liveChatTemplates: liveChatTemplatesResult.data ?? [],
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
      createSupabaseServiceRoleClient();
    },
    async readStore() {
      const client = createSupabaseServiceRoleClient();
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
          role:
            typeof bot.role === "string"
              ? bot.role
              : undefined,
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
        triggerRules: [],
        timerTriggers: [],
        matchLogs: [],
        timerTriggerLogs: [],
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
        liveChatTemplates: data.liveChatTemplates.map((template) => ({
          id: String(template.id),
          sessionId: String(template.session_id ?? ""),
          name: String(template.name ?? ""),
          message: String(template.message ?? ""),
          senderMode:
            template.sender_mode === "all_bots"
              ? "all_bots"
              : template.sender_mode === "round_robin"
                ? "round_robin"
                : "selected_bots",
          botIds: normalizeJsonArray(template.bot_ids),
          roundRobinIndex: Number(template.round_robin_index ?? 0),
          lastSentBotId:
            typeof template.last_sent_bot_id === "string"
              ? template.last_sent_bot_id
              : null,
          lastSentAt:
            typeof template.last_sent_at === "string"
              ? template.last_sent_at
              : null,
          createdAt: String(template.created_at ?? new Date().toISOString()),
          updatedAt: String(template.updated_at ?? new Date().toISOString()),
        })),
        webhookDebugLogs: [],
        transcriptLogs: [],
      });
    },
    async writeStore(data) {
      const client = createSupabaseServiceRoleClient();
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
      await syncTable(client, "live_chat_logs", rows.live_chat_logs);
      await syncTable(client, "live_chat_templates", rows.live_chat_templates);
    },
  };
}
