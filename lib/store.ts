import { randomUUID } from "node:crypto";
import { isBotActiveStatus, isBotInCallStatus } from "@/lib/bot-status";
import { normalizeTranscript } from "@/lib/normalize";
import {
  buildCreateRecallBotPayload,
  createRecallBot,
  getRecallBot,
  getRecallWebhookUrl,
  getRecallPreflight,
  isRecallSendChatEnabled,
  stopRecallBot,
  sendRecallChatMessage,
} from "@/lib/recall";
import { createStorageAdapter } from "@/lib/storage";
import { getStorageDriver } from "@/lib/storage/config";
import { createSupabaseServiceRoleClient } from "@/lib/storage/supabase-store";
import { getSessionOperationBlockedMessage, isSessionActiveForOperations } from "@/lib/session-operations";
import { FIXED_TRANSCRIPT_LANGUAGE } from "@/lib/transcript-language";
import type {
  MeetingSession,
  MeetingSessionStatus,
  LiveChatLog,
  MatchLog,
  MatchSenderResult,
  PaginatedResult,
  RecallBotRecord,
  RecallBotRole,
  ScheduledBotJoin,
  ScheduledBotJoinStatus,
  SenderMode,
  StorageLoggingMode,
  StoreData,
  TimerTrigger,
  TimerTriggerSenderMode,
  TimerTriggerLog,
  TranscriptLog,
  TriggerRule,
  WebhookDebugLog,
} from "@/lib/types";
export const DEFAULT_SESSION_ID = "default-session";
export const DEFAULT_SESSION_NAME = "Default Session";
const activeTriggerExecutionLocks = new Map<
  string,
  {
    executionId: string;
    acceptedAt: number;
  }
>();

export const emptyStore: StoreData = {
  storageLoggingMode: "production_minimal",
  meetingSessions: [buildDefaultMeetingSession()],
  scheduledBotJoins: [],
  triggerRules: [],
  transcriptLogs: [],
  matchLogs: [],
  recallBots: [],
  timerTriggers: [],
  timerTriggerLogs: [],
  liveChatLogs: [],
  liveChatRoundRobinIndex: 0,
  webhookDebugLogs: [],
};

export const storeCorruptionRecoveryError =
  "data/store.json is corrupted and no valid backup exists. Stop the app and restore/reset the store file.";
let storeMutationQueue: Promise<void> = Promise.resolve();

export function isStoreCorruptionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "data/store.json is corrupted and no valid backup exists",
    )
  );
}

export async function getStorageHealth(): Promise<{
  storageDriver: ReturnType<typeof getStorageDriver>;
  ok: boolean;
  checkedAt: string;
  error: string | null;
}> {
  const checkedAt = new Date().toISOString();
  const storageDriver = getStorageDriver();

  try {
    await readStore();

    return {
      storageDriver,
      ok: true,
      checkedAt,
      error: null,
    };
  } catch (error) {
    return {
      storageDriver,
      ok: false,
      checkedAt,
      error:
        error instanceof Error
          ? error.message
          : "Failed to read the configured storage driver.",
    };
  }
}

type LegacyTriggerRule = Partial<TriggerRule> & {
  normalizedTriggerPhrase?: string;
};

type LegacyMeetingSession = Partial<MeetingSession>;
type LegacyRecallBotRecord = Partial<RecallBotRecord>;
type LegacyScheduledBotJoin = Partial<ScheduledBotJoin>;
type LegacyMatchLog = Partial<MatchLog>;
type LegacyTimerTrigger = Partial<TimerTrigger>;
type LegacyTimerTriggerLog = Partial<TimerTriggerLog>;
type LegacyLiveChatLog = Partial<LiveChatLog>;

type PaginationOptions = {
  page?: number;
  pageSize?: number;
};

type TriggerRuleListOptions = PaginationOptions & {
  sessionId?: string;
  search?: string;
  status?: "enabled" | "disabled";
  triggerSearch?: string;
  replySearch?: string;
};

type RecallBotListOptions = PaginationOptions & {
  sessionId?: string;
  search?: string;
  botId?: string;
  status?: string;
  name?: string;
  meetingUrl?: string;
};

type TranscriptLogListOptions = PaginationOptions & {
  sessionId?: string;
  search?: string;
  botId?: string;
};

type MatchLogListOptions = PaginationOptions & {
  sessionId?: string;
  search?: string;
  botId?: string;
  status?: MatchLog["status"];
  triggerSearch?: string;
  replySearch?: string;
};

type WebhookDebugLogListOptions = PaginationOptions & {
  sessionId?: string;
  search?: string;
  botId?: string;
  event?: string;
  status?: WebhookDebugLog["status"];
};

type TimerTriggerListOptions = PaginationOptions & {
  sessionId?: string;
};

type ScheduledBotJoinListOptions = PaginationOptions & {
  sessionId?: string;
};

type TimerTriggerLogListOptions = PaginationOptions & {
  sessionId?: string;
};
type LiveChatLogListOptions = PaginationOptions & {
  sessionId?: string;
};

type AppSettings = {
  storageLoggingMode: StorageLoggingMode;
};

type SenderTarget = {
  senderBotId: string | null;
  senderBotName: string | null;
  isAvailable: boolean;
  errorMessage: string | null;
};

type SenderTargetBuildResult = {
  senderTargets: SenderTarget[];
  originalSenderBotIds: string[];
  dedupedSenderBotIds: string[];
  warningMessages: string[];
  chosenRoundRobinBotId: string | null;
  chosenRoundRobinBotName: string | null;
  previousRoundRobinIndex: number | null;
  nextRoundRobinIndex: number | null;
};

export function normalizeStoreData(
  rawParsed: unknown,
): StoreData {
  const parsed = rawParsed as Partial<StoreData> & {
    meetingSessions?: LegacyMeetingSession[];
    scheduledBotJoins?: LegacyScheduledBotJoin[];
    triggerRules?: LegacyTriggerRule[];
    recallBots?: LegacyRecallBotRecord[];
    matchLogs?: LegacyMatchLog[];
    timerTriggers?: LegacyTimerTrigger[];
    timerTriggerLogs?: LegacyTimerTriggerLog[];
    liveChatLogs?: LegacyLiveChatLog[];
  };

  let meetingSessions = (parsed.meetingSessions ?? []).map(migrateMeetingSession);
  const shouldCreateDefaultSession =
    meetingSessions.length === 0 ||
    hasRecordsMissingValidSession(parsed, new Set(meetingSessions.map((session) => session.id)));

  if (shouldCreateDefaultSession && !meetingSessions.some((session) => session.id === DEFAULT_SESSION_ID)) {
    meetingSessions = [buildDefaultMeetingSession(), ...meetingSessions];
  }

  if (meetingSessions.length === 0) {
    meetingSessions = [buildDefaultMeetingSession()];
  }

  const validSessionIds = new Set(meetingSessions.map((session) => session.id));
  const resolveSessionId = (value: unknown) =>
    normalizeExistingSessionId(value, validSessionIds);

  return {
    storageLoggingMode: normalizeStorageLoggingMode(
      (parsed as { storageLoggingMode?: unknown }).storageLoggingMode,
    ),
    meetingSessions,
    scheduledBotJoins: (parsed.scheduledBotJoins ?? []).map((rawScheduledBotJoin) => ({
      ...migrateScheduledBotJoin(rawScheduledBotJoin),
      sessionId: resolveSessionId(rawScheduledBotJoin.sessionId),
    })),
    triggerRules: (parsed.triggerRules ?? []).map((rawRule) => ({
      ...migrateTriggerRule(rawRule),
      sessionId: resolveSessionId(rawRule.sessionId),
    })),
    transcriptLogs: (parsed.transcriptLogs ?? []).map((log) => ({
      ...log,
      sessionId: resolveSessionId((log as { sessionId?: unknown }).sessionId),
      sourceEvent: log.sourceEvent ?? "transcript.data",
    })),
    matchLogs: (parsed.matchLogs ?? []).map((rawLog) => ({
      ...migrateMatchLog(rawLog),
      sessionId: resolveSessionId(rawLog.sessionId),
    })),
    recallBots: (parsed.recallBots ?? []).map((rawBot) => ({
      ...migrateRecallBotRecord(rawBot),
      sessionId: resolveSessionId(rawBot.sessionId),
    })),
    timerTriggers: (parsed.timerTriggers ?? []).map((rawTrigger) => ({
      ...migrateTimerTrigger(rawTrigger),
      sessionId: resolveSessionId(rawTrigger.sessionId),
    })),
    timerTriggerLogs: (parsed.timerTriggerLogs ?? []).map((rawLog) => ({
      ...migrateTimerTriggerLog(rawLog),
      sessionId: resolveSessionId(rawLog.sessionId),
    })),
    liveChatLogs: (parsed.liveChatLogs ?? []).map((rawLog) => ({
      ...migrateLiveChatLog(rawLog),
      sessionId: resolveSessionId(rawLog.sessionId),
    })),
    liveChatRoundRobinIndex: normalizeNonNegativeInteger(
      Number((parsed as { liveChatRoundRobinIndex?: unknown }).liveChatRoundRobinIndex ?? 0),
    ),
    webhookDebugLogs: (parsed.webhookDebugLogs ?? []).map((rawLog) => ({
      id: String(rawLog.id ?? randomUUID()),
      sessionId: resolveSessionId((rawLog as { sessionId?: unknown }).sessionId),
      eventName: String(rawLog.eventName ?? "unknown"),
      rawPayload: rawLog.rawPayload ?? null,
      receivedAt:
        typeof rawLog.receivedAt === "string"
          ? rawLog.receivedAt
          : new Date().toISOString(),
      botId:
        typeof rawLog.botId === "string" ? rawLog.botId.trim() : null,
      status:
        rawLog.status === "processed" ||
        rawLog.status === "ignored" ||
        rawLog.status === "failed" ||
        rawLog.status === "unknown"
          ? rawLog.status
          : "unknown",
      extractedTranscriptText:
        typeof rawLog.extractedTranscriptText === "string"
          ? rawLog.extractedTranscriptText
          : null,
      errorMessage:
        typeof rawLog.errorMessage === "string" ? rawLog.errorMessage : null,
    })),
  };
}

function buildDefaultMeetingSession(): MeetingSession {
  const now = new Date().toISOString();

  return {
    id: DEFAULT_SESSION_ID,
    name: DEFAULT_SESSION_NAME,
    zoomUrl: "",
    status: "active",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    endedAt: null,
    notes: "Automatically created for older records that did not have a session.",
  };
}

function migrateMeetingSession(rawSession: LegacyMeetingSession): MeetingSession {
  const createdAt =
    typeof rawSession.createdAt === "string"
      ? rawSession.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof rawSession.updatedAt === "string" ? rawSession.updatedAt : createdAt;

  return {
    id: String(rawSession.id ?? randomUUID()).trim() || randomUUID(),
    name: String(rawSession.name ?? "Untitled Session").trim() || "Untitled Session",
    zoomUrl: String(rawSession.zoomUrl ?? "").trim(),
    status: normalizeMeetingSessionStatus(rawSession.status),
    createdAt,
    updatedAt,
    startedAt:
      typeof rawSession.startedAt === "string" ? rawSession.startedAt : null,
    endedAt: typeof rawSession.endedAt === "string" ? rawSession.endedAt : null,
    notes: String(rawSession.notes ?? "").trim(),
  };
}

function normalizeMeetingSessionStatus(
  value: MeetingSessionStatus | string | undefined,
): MeetingSessionStatus {
  if (
    value === "draft" ||
    value === "active" ||
    value === "ended" ||
    value === "archived"
  ) {
    return value;
  }

  return "draft";
}

function normalizeScheduledBotJoinStatus(
  value: ScheduledBotJoinStatus | string | undefined,
): ScheduledBotJoinStatus {
  if (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return "pending";
}

function migrateScheduledBotJoin(
  rawScheduledBotJoin: LegacyScheduledBotJoin,
): ScheduledBotJoin {
  const createdAt =
    typeof rawScheduledBotJoin.createdAt === "string"
      ? rawScheduledBotJoin.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof rawScheduledBotJoin.updatedAt === "string"
      ? rawScheduledBotJoin.updatedAt
      : createdAt;
  const rawBotCount = Number(rawScheduledBotJoin.botCount ?? 1);
  const botCount = Number.isFinite(rawBotCount)
    ? Math.min(20, Math.max(1, Math.floor(rawBotCount)))
    : 1;
  const botNames = Array.isArray(rawScheduledBotJoin.botNames)
    ? rawScheduledBotJoin.botNames
        .map((botName) => String(botName ?? "").trim())
        .filter(Boolean)
    : Array.from({ length: botCount }, (_, index) => `Bot ${index + 1}`);

  return {
    id: String(rawScheduledBotJoin.id ?? randomUUID()).trim() || randomUUID(),
    sessionId: DEFAULT_SESSION_ID,
    name:
      String(rawScheduledBotJoin.name ?? "").trim() || "Scheduled Bot Join",
    enabled: rawScheduledBotJoin.enabled ?? true,
    scheduledAt:
      typeof rawScheduledBotJoin.scheduledAt === "string"
        ? rawScheduledBotJoin.scheduledAt
        : createdAt,
    botCount,
    botNames:
      botNames.length === botCount
        ? botNames
        : Array.from({ length: botCount }, (_, index) =>
            botNames[index] || `Bot ${index + 1}`,
          ),
    transcriptLanguage:
      String(rawScheduledBotJoin.transcriptLanguage ?? "zh-CN").trim() || "zh-CN",
    status: normalizeScheduledBotJoinStatus(rawScheduledBotJoin.status),
    createdBotIds: Array.isArray(rawScheduledBotJoin.createdBotIds)
      ? rawScheduledBotJoin.createdBotIds
          .map((botId) => String(botId ?? "").trim())
          .filter(Boolean)
      : [],
    lastRunAt:
      typeof rawScheduledBotJoin.lastRunAt === "string"
        ? rawScheduledBotJoin.lastRunAt
        : null,
    errorMessage:
      typeof rawScheduledBotJoin.errorMessage === "string"
        ? rawScheduledBotJoin.errorMessage
        : null,
    createdAt,
    updatedAt,
  };
}

function normalizeExistingSessionId(
  value: unknown,
  validSessionIds: Set<string>,
): string {
  if (typeof value === "string") {
    const trimmedValue = value.trim();

    if (trimmedValue && validSessionIds.has(trimmedValue)) {
      return trimmedValue;
    }
  }

  return DEFAULT_SESSION_ID;
}

function hasRecordsMissingValidSession(
  parsed: Partial<StoreData> & {
    triggerRules?: LegacyTriggerRule[];
    recallBots?: LegacyRecallBotRecord[];
    matchLogs?: LegacyMatchLog[];
    timerTriggers?: LegacyTimerTrigger[];
    timerTriggerLogs?: LegacyTimerTriggerLog[];
    liveChatLogs?: LegacyLiveChatLog[];
  },
  validSessionIds: Set<string>,
): boolean {
  const rawRecordLists: unknown[][] = [
    parsed.triggerRules ?? [],
    parsed.transcriptLogs ?? [],
    parsed.matchLogs ?? [],
    parsed.recallBots ?? [],
    parsed.timerTriggers ?? [],
    parsed.timerTriggerLogs ?? [],
    parsed.liveChatLogs ?? [],
    parsed.webhookDebugLogs ?? [],
  ];

  return rawRecordLists.some((records) =>
    records.some((record) => {
      if (!record || typeof record !== "object") {
        return true;
      }

      const recordSessionId = (record as { sessionId?: unknown }).sessionId;
      return (
        typeof recordSessionId !== "string" ||
        recordSessionId.trim() === "" ||
        !validSessionIds.has(recordSessionId.trim())
      );
    }),
  );
}

function parseStoreData(raw: string): StoreData {
  const parsed = JSON.parse(raw) as Partial<StoreData> & {
    triggerRules?: LegacyTriggerRule[];
    recallBots?: LegacyRecallBotRecord[];
    matchLogs?: LegacyMatchLog[];
    timerTriggers?: LegacyTimerTrigger[];
    timerTriggerLogs?: LegacyTimerTriggerLog[];
  };

  return normalizeStoreData(parsed);
}

function migrateTriggerRule(rawRule: LegacyTriggerRule): TriggerRule {
  const triggerPhrase = String(rawRule.triggerPhrase ?? "").trim();
  const rawMaxTriggerCount = Number(rawRule.maxTriggerCount ?? 0);
  const rawNextSenderIndex = Number(rawRule.nextSenderIndex ?? 0);

  return {
    id: String(rawRule.id ?? randomUUID()),
    sessionId: DEFAULT_SESSION_ID,
    triggerPhrase,
    normalizedTrigger:
      String(
        rawRule.normalizedTrigger ??
          rawRule.normalizedTriggerPhrase ??
          normalizeTranscript(triggerPhrase),
      ) || normalizeTranscript(triggerPhrase),
    replyMessage: String(rawRule.replyMessage ?? "").trim(),
    cooldownSeconds: Math.max(0, Math.floor(Number(rawRule.cooldownSeconds ?? 0))),
    responseDelaySeconds: Math.min(
      300,
      Math.max(0, Math.floor(Number(rawRule.responseDelaySeconds ?? 0))),
    ),
    senderMode: normalizeSenderMode(rawRule.senderMode),
    senderBotIds: Array.isArray(rawRule.senderBotIds)
      ? rawRule.senderBotIds
          .map((botId) => String(botId ?? "").trim())
          .filter(Boolean)
      : [],
    nextSenderIndex:
      Number.isFinite(rawNextSenderIndex) && rawNextSenderIndex >= 0
        ? Math.floor(rawNextSenderIndex)
        : 0,
    triggerCount: Math.max(0, Math.floor(Number(rawRule.triggerCount ?? 0))),
    maxTriggerCount:
      Number.isFinite(rawMaxTriggerCount) && rawMaxTriggerCount > 0
        ? Math.floor(rawMaxTriggerCount)
        : null,
    enabled: rawRule.enabled ?? true,
    lastMatchedAt:
      typeof rawRule.lastMatchedAt === "string" ? rawRule.lastMatchedAt : null,
    lastTriggeredAt:
      typeof rawRule.lastTriggeredAt === "string"
        ? rawRule.lastTriggeredAt
        : null,
    createdAt:
      typeof rawRule.createdAt === "string"
        ? rawRule.createdAt
        : new Date().toISOString(),
  };
}

function migrateMatchLog(rawLog: LegacyMatchLog): MatchLog {
  const legacyBotId =
    typeof rawLog.botId === "string" ? rawLog.botId.trim() : null;
  const rawMaxTriggerCount = Number(rawLog.maxTriggerCount ?? 0);
  const senderResult: MatchSenderResult = {
    senderBotId: legacyBotId,
    senderBotName: null,
    status:
      rawLog.status === "dry_run" ||
      rawLog.status === "sent" ||
      rawLog.status === "failed" ||
      rawLog.status === "no_active_sender_bot" ||
      rawLog.status === "skipped_dedupe" ||
      rawLog.status === "skipped_duplicate_sender_execution"
        ? rawLog.status
        : "dry_run",
    errorMessage:
      typeof rawLog.errorMessage === "string" ? rawLog.errorMessage : null,
    action: String(rawLog.action ?? "").trim(),
  };

  const senderResults = Array.isArray(rawLog.senderResults)
    ? rawLog.senderResults.map((result) => ({
        senderBotId:
          typeof result?.senderBotId === "string"
            ? result.senderBotId.trim()
            : null,
        senderBotName:
          typeof result?.senderBotName === "string"
            ? result.senderBotName.trim()
            : null,
        status:
          result?.status === "dry_run" ||
          result?.status === "sent" ||
          result?.status === "failed" ||
          result?.status === "no_active_sender_bot" ||
          result?.status === "skipped_dedupe" ||
          result?.status === "skipped_duplicate_sender_execution"
            ? result.status
            : "dry_run",
        errorMessage:
          typeof result?.errorMessage === "string" ? result.errorMessage : null,
        action: String(result?.action ?? "").trim(),
      }))
    : [senderResult];

  return {
    id: String(rawLog.id ?? randomUUID()),
    sessionId: DEFAULT_SESSION_ID,
    botId: legacyBotId,
    sourceWebhookBotId:
      typeof rawLog.sourceWebhookBotId === "string"
        ? rawLog.sourceWebhookBotId.trim()
        : legacyBotId,
    ruleId: String(rawLog.ruleId ?? "").trim(),
    triggerPhrase: String(rawLog.triggerPhrase ?? "").trim(),
    replyMessage: String(rawLog.replyMessage ?? "").trim(),
    transcriptText: String(rawLog.transcriptText ?? "").trim(),
    normalizedTranscriptText:
      String(rawLog.normalizedTranscriptText ?? "").trim() ||
      normalizeTranscript(String(rawLog.transcriptText ?? "")),
    createdAt:
      typeof rawLog.createdAt === "string"
        ? rawLog.createdAt
        : new Date().toISOString(),
    status:
      rawLog.status === "dry_run" ||
      rawLog.status === "sent" ||
      rawLog.status === "failed" ||
      rawLog.status === "no_active_sender_bot" ||
      rawLog.status === "skipped_dedupe" ||
      rawLog.status === "skipped_duplicate_sender_execution"
        ? rawLog.status
        : senderResults[0]?.status ?? "dry_run",
    triggerExecutionId:
      typeof rawLog.triggerExecutionId === "string"
        ? rawLog.triggerExecutionId.trim()
        : null,
    sourceEvent:
      rawLog.sourceEvent === "transcript.partial_data"
        ? "transcript.partial_data"
        : "transcript.data",
    senderMode: normalizeSenderMode(rawLog.senderMode),
    senderBotIdsUsed: Array.isArray(rawLog.senderBotIdsUsed)
      ? rawLog.senderBotIdsUsed
          .map((botId) => String(botId ?? "").trim())
          .filter(Boolean)
      : legacyBotId
        ? [legacyBotId]
        : [],
    originalSenderBotIds: Array.isArray(rawLog.originalSenderBotIds)
      ? rawLog.originalSenderBotIds
          .map((botId) => String(botId ?? "").trim())
          .filter(Boolean)
      : Array.isArray(rawLog.senderBotIdsUsed)
        ? rawLog.senderBotIdsUsed
            .map((botId) => String(botId ?? "").trim())
            .filter(Boolean)
        : legacyBotId
          ? [legacyBotId]
          : [],
    dedupedSenderBotIds: Array.isArray(rawLog.dedupedSenderBotIds)
      ? rawLog.dedupedSenderBotIds
          .map((botId) => String(botId ?? "").trim())
          .filter(Boolean)
      : Array.isArray(rawLog.senderBotIdsUsed)
        ? rawLog.senderBotIdsUsed
            .map((botId) => String(botId ?? "").trim())
            .filter(Boolean)
        : legacyBotId
          ? [legacyBotId]
          : [],
    chosenRoundRobinBotId:
      typeof rawLog.chosenRoundRobinBotId === "string"
        ? rawLog.chosenRoundRobinBotId.trim()
        : null,
    chosenRoundRobinBotName:
      typeof rawLog.chosenRoundRobinBotName === "string"
        ? rawLog.chosenRoundRobinBotName.trim()
        : null,
    previousRoundRobinIndex:
      rawLog.previousRoundRobinIndex === null ||
      rawLog.previousRoundRobinIndex === undefined
        ? null
        : Math.max(0, Math.floor(Number(rawLog.previousRoundRobinIndex))),
    nextRoundRobinIndex:
      rawLog.nextRoundRobinIndex === null || rawLog.nextRoundRobinIndex === undefined
        ? null
        : Math.max(0, Math.floor(Number(rawLog.nextRoundRobinIndex))),
    responseDelaySeconds: Math.min(
      300,
      Math.max(0, Math.floor(Number(rawLog.responseDelaySeconds ?? 0))),
    ),
    triggerCountAfter:
      rawLog.triggerCountAfter === null || rawLog.triggerCountAfter === undefined
        ? null
        : Math.max(0, Math.floor(Number(rawLog.triggerCountAfter))),
    maxTriggerCount:
      Number.isFinite(rawMaxTriggerCount) && rawMaxTriggerCount > 0
        ? Math.floor(rawMaxTriggerCount)
        : null,
    autoDisabledAfterTrigger: rawLog.autoDisabledAfterTrigger === true,
    sendAttemptCount: Math.max(
      0,
      Math.floor(Number(rawLog.sendAttemptCount ?? senderResults.length)),
    ),
    actualSendCount: Math.max(
      0,
      Math.floor(
        Number(
          rawLog.actualSendCount ??
            senderResults.filter(
              (senderResult) => senderResult.status === "sent",
            ).length,
        ),
      ),
    ),
    warningMessages: Array.isArray(rawLog.warningMessages)
      ? rawLog.warningMessages
          .map((message) => String(message ?? "").trim())
          .filter(Boolean)
      : [],
    senderResults,
    errorMessage:
      typeof rawLog.errorMessage === "string" ? rawLog.errorMessage : null,
    action: String(rawLog.action ?? "").trim(),
  };
}

function migrateRecallBotRecord(rawRecord: LegacyRecallBotRecord): RecallBotRecord {
  const createRequestPayload =
    rawRecord.createRequestPayload &&
    typeof rawRecord.createRequestPayload === "object" &&
    !Array.isArray(rawRecord.createRequestPayload)
      ? (rawRecord.createRequestPayload as Record<string, unknown>)
      : {};
  const rawRecallResponse =
    rawRecord.rawRecallResponse && typeof rawRecord.rawRecallResponse === "object"
      ? (rawRecord.rawRecallResponse as Record<string, unknown>)
      : {};

  return {
    id: String(rawRecord.id ?? randomUUID()),
    sessionId: DEFAULT_SESSION_ID,
    recallBotId: String(rawRecord.recallBotId ?? "").trim(),
    meetingUrl: String(rawRecord.meetingUrl ?? "").trim(),
    botName: String(rawRecord.botName ?? "").trim(),
    role: normalizeRecallBotRole(rawRecord.role, {
      createRequestPayload,
      rawRecallResponse,
    }),
    transcriptLanguage: String(rawRecord.transcriptLanguage ?? "").trim(),
    webhookUrl: String(rawRecord.webhookUrl ?? "").trim(),
    status: String(rawRecord.status ?? "created"),
    createdAt:
      typeof rawRecord.createdAt === "string"
        ? rawRecord.createdAt
        : new Date().toISOString(),
    joinedAt:
      typeof rawRecord.joinedAt === "string" ? rawRecord.joinedAt : null,
    lastStatusCheckedAt:
      typeof rawRecord.lastStatusCheckedAt === "string"
        ? rawRecord.lastStatusCheckedAt
        : null,
    lastErrorMessage:
      typeof rawRecord.lastErrorMessage === "string"
        ? rawRecord.lastErrorMessage
        : null,
    lastStopAttempt:
      rawRecord.lastStopAttempt &&
      typeof rawRecord.lastStopAttempt === "object" &&
      !Array.isArray(rawRecord.lastStopAttempt)
        ? {
            endpoint: String(
              (rawRecord.lastStopAttempt as Record<string, unknown>).endpoint ?? "",
            ).trim(),
            httpStatus:
              typeof (rawRecord.lastStopAttempt as Record<string, unknown>)
                .httpStatus === "number"
                ? Number(
                    (rawRecord.lastStopAttempt as Record<string, unknown>).httpStatus,
                  )
                : null,
            attemptedAt:
              typeof (rawRecord.lastStopAttempt as Record<string, unknown>)
                .attemptedAt === "string"
                ? String(
                    (rawRecord.lastStopAttempt as Record<string, unknown>).attemptedAt,
                  )
                : new Date().toISOString(),
            recallResponseBody:
              (rawRecord.lastStopAttempt as Record<string, unknown>)
                .recallResponseBody ?? null,
            errorMessage:
              typeof (rawRecord.lastStopAttempt as Record<string, unknown>)
                .errorMessage === "string"
                ? String(
                    (rawRecord.lastStopAttempt as Record<string, unknown>).errorMessage,
                  )
                : null,
          }
        : null,
    createRequestPayload,
    rawRecallResponse,
  };
}

function hasTranscriptConfig(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const recordingConfig = (value as Record<string, unknown>).recording_config;

  if (!recordingConfig || typeof recordingConfig !== "object" || Array.isArray(recordingConfig)) {
    return false;
  }

  const transcript = (recordingConfig as Record<string, unknown>).transcript;
  const realtimeEndpoints = (recordingConfig as Record<string, unknown>).realtime_endpoints;

  return Boolean(transcript) || (Array.isArray(realtimeEndpoints) && realtimeEndpoints.length > 0);
}

function normalizeRecallBotRole(
  value: unknown,
  input?: {
    createRequestPayload?: Record<string, unknown>;
    rawRecallResponse?: Record<string, unknown>;
  },
): RecallBotRole {
  if (value === "listener" || value === "sender") {
    return value;
  }

  if (
    hasTranscriptConfig(input?.createRequestPayload) ||
    hasTranscriptConfig(input?.rawRecallResponse)
  ) {
    return "listener";
  }

  return "sender";
}

function migrateTimerTrigger(rawTrigger: LegacyTimerTrigger): TimerTrigger {
  const rawMaxTriggerCount = Number(rawTrigger.maxTriggerCount ?? 0);
  const rawNextSenderIndex = Number(rawTrigger.nextSenderIndex ?? 0);

  return {
    id: String(rawTrigger.id ?? randomUUID()),
    sessionId: DEFAULT_SESSION_ID,
    name: String(rawTrigger.name ?? "").trim(),
    enabled: rawTrigger.enabled ?? true,
    delayMinutesAfterJoin: Math.max(
      0,
      Math.floor(Number(rawTrigger.delayMinutesAfterJoin ?? 0)),
    ),
    message: String(rawTrigger.message ?? "").trim(),
    senderMode: normalizeTimerTriggerSenderMode(rawTrigger.senderMode),
    senderBotIds: Array.isArray(rawTrigger.senderBotIds)
      ? rawTrigger.senderBotIds
          .map((botId) => String(botId ?? "").trim())
          .filter(Boolean)
      : [],
    nextSenderIndex:
      Number.isFinite(rawNextSenderIndex) && rawNextSenderIndex >= 0
        ? Math.floor(rawNextSenderIndex)
        : 0,
    responseDelaySeconds: Math.min(
      300,
      Math.max(0, Math.floor(Number(rawTrigger.responseDelaySeconds ?? 0))),
    ),
    maxTriggerCount:
      Number.isFinite(rawMaxTriggerCount) && rawMaxTriggerCount > 0
        ? Math.floor(rawMaxTriggerCount)
        : null,
    triggerCount: Math.max(0, Math.floor(Number(rawTrigger.triggerCount ?? 0))),
    lastTriggeredAt:
      typeof rawTrigger.lastTriggeredAt === "string"
        ? rawTrigger.lastTriggeredAt
        : null,
    createdAt:
      typeof rawTrigger.createdAt === "string"
        ? rawTrigger.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof rawTrigger.updatedAt === "string"
        ? rawTrigger.updatedAt
        : typeof rawTrigger.createdAt === "string"
          ? rawTrigger.createdAt
          : new Date().toISOString(),
  };
}

function migrateTimerTriggerLog(
  rawLog: LegacyTimerTriggerLog,
): TimerTriggerLog {
  return {
    id: String(rawLog.id ?? randomUUID()),
    sessionId: DEFAULT_SESSION_ID,
    timerTriggerId: String(rawLog.timerTriggerId ?? "").trim(),
    timerTriggerName: String(rawLog.timerTriggerName ?? "").trim(),
    scheduledFor:
      typeof rawLog.scheduledFor === "string"
        ? rawLog.scheduledFor
        : new Date().toISOString(),
    executedAt:
      typeof rawLog.executedAt === "string"
        ? rawLog.executedAt
        : new Date().toISOString(),
    message: String(rawLog.message ?? "").trim(),
    senderMode: normalizeTimerTriggerSenderMode(rawLog.senderMode),
    senderBotIdUsed:
      typeof rawLog.senderBotIdUsed === "string" && rawLog.senderBotIdUsed.trim()
        ? rawLog.senderBotIdUsed.trim()
        : null,
    senderBotIdsUsed: Array.isArray(rawLog.senderBotIdsUsed)
      ? rawLog.senderBotIdsUsed
          .map((botId) => String(botId ?? "").trim())
          .filter(Boolean)
      : typeof rawLog.senderBotIdUsed === "string" && rawLog.senderBotIdUsed.trim()
        ? [rawLog.senderBotIdUsed.trim()]
        : [],
    status:
      rawLog.status === "dry_run" ||
      rawLog.status === "sent" ||
      rawLog.status === "failed" ||
      rawLog.status === "no_active_sender_bot" ||
      rawLog.status === "skipped_not_due" ||
      rawLog.status === "skipped_limit_reached"
        ? rawLog.status
        : "dry_run",
    errorMessage:
      typeof rawLog.errorMessage === "string" ? rawLog.errorMessage : null,
  };
}

function migrateLiveChatLog(rawLog: LegacyLiveChatLog): LiveChatLog {
  const senderResults = Array.isArray(rawLog.senderResults)
    ? rawLog.senderResults.map((result) => ({
        senderBotId:
          typeof result?.senderBotId === "string"
            ? result.senderBotId.trim()
            : null,
        senderBotName:
          typeof result?.senderBotName === "string"
            ? result.senderBotName.trim()
            : null,
        status:
          result?.status === "dry_run" ||
          result?.status === "sent" ||
          result?.status === "failed" ||
          result?.status === "no_active_sender_bot" ||
          result?.status === "skipped_dedupe" ||
          result?.status === "skipped_duplicate_sender_execution"
            ? result.status
            : "dry_run",
        errorMessage:
          typeof result?.errorMessage === "string" ? result.errorMessage : null,
        action: String(result?.action ?? "").trim(),
      }))
    : [];

  return {
    id: String(rawLog.id ?? randomUUID()),
    sessionId: DEFAULT_SESSION_ID,
    message: String(rawLog.message ?? "").trim(),
    senderMode: normalizeSenderMode(rawLog.senderMode),
    senderBotIdsUsed: Array.isArray(rawLog.senderBotIdsUsed)
      ? rawLog.senderBotIdsUsed
          .map((botId) => String(botId ?? "").trim())
          .filter(Boolean)
      : [],
    senderResults,
    status:
      rawLog.status === "dry_run" ||
      rawLog.status === "sent" ||
      rawLog.status === "failed" ||
      rawLog.status === "no_active_sender_bot" ||
      rawLog.status === "skipped_dedupe" ||
      rawLog.status === "skipped_duplicate_sender_execution"
        ? rawLog.status
        : senderResults[0]?.status ?? "dry_run",
    createdAt:
      typeof rawLog.createdAt === "string"
        ? rawLog.createdAt
        : new Date().toISOString(),
    errorMessage:
      typeof rawLog.errorMessage === "string" ? rawLog.errorMessage : null,
  };
}

async function readStore(): Promise<StoreData> {
  const storageAdapter = createStorageAdapter({
    emptyStore,
    normalizeStoreData,
    corruptionRecoveryError: storeCorruptionRecoveryError,
  });

  return storageAdapter.readStore();
}

function queueStoreMutation<T>(
  mutation: () => Promise<T>,
): Promise<T> {
  const result = storeMutationQueue.then(mutation, mutation);
  storeMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function mutateStore<T>(
  mutation: (store: StoreData) => Promise<T> | T,
): Promise<T> {
  return queueStoreMutation(async () => {
    const storageAdapter = createStorageAdapter({
      emptyStore,
      normalizeStoreData,
      corruptionRecoveryError: storeCorruptionRecoveryError,
    });
    await storageAdapter.initialize();
    const store = await readStore();
    const previousRawStore =
      storageAdapter.driver === "local" ? JSON.stringify(store, null, 2) : null;
    const result = await mutation(store);
    await storageAdapter.writeStore(store, {
      previousRawStore,
    });
    return result;
  });
}

function normalizeSearchTerm(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeStorageLoggingMode(value: unknown): StorageLoggingMode {
  return value === "debug" ? "debug" : "production_minimal";
}

function normalizeSessionIdInput(value: string | undefined | null): string {
  const trimmedValue = value?.trim();
  return trimmedValue || DEFAULT_SESSION_ID;
}

function ensureDefaultSessionExists(store: StoreData): MeetingSession {
  let defaultSession = store.meetingSessions.find(
    (session) => session.id === DEFAULT_SESSION_ID,
  );

  if (!defaultSession) {
    defaultSession = buildDefaultMeetingSession();
    store.meetingSessions.unshift(defaultSession);
  }

  return defaultSession;
}

function findMeetingSessionById(
  store: Pick<StoreData, "meetingSessions">,
  sessionId: string | undefined | null,
): MeetingSession | undefined {
  const normalizedSessionId = normalizeSessionIdInput(sessionId);

  return store.meetingSessions.find((session) => session.id === normalizedSessionId);
}

function matchesSessionId(
  recordSessionId: string,
  requestedSessionId: string | undefined,
): boolean {
  if (!requestedSessionId) {
    return true;
  }

  return recordSessionId === normalizeSessionIdInput(requestedSessionId);
}

function isDebugStorageLoggingMode(store: Pick<StoreData, "storageLoggingMode">): boolean {
  return store.storageLoggingMode === "debug";
}

function shouldPersistWebhookDebugLog(
  store: Pick<StoreData, "storageLoggingMode">,
  status: WebhookDebugLog["status"],
): boolean {
  return isDebugStorageLoggingMode(store) || status === "failed";
}

function shouldPersistTranscriptLog(
  store: Pick<StoreData, "storageLoggingMode">,
): boolean {
  return isDebugStorageLoggingMode(store);
}

function shouldPersistSkippedTimerTriggerLog(
  store: Pick<StoreData, "storageLoggingMode">,
): boolean {
  return isDebugStorageLoggingMode(store);
}

function matchesSearch(
  search: string,
  values: Array<string | null | undefined>,
): boolean {
  if (!search) {
    return true;
  }

  return values.some((value) => value?.toLowerCase().includes(search));
}

function normalizePageNumber(value?: number): number {
  if (!value || Number.isNaN(value) || value < 1) {
    return 1;
  }

  return Math.floor(value);
}

function normalizePageSize(value?: number): number {
  if (!value || Number.isNaN(value) || value < 1) {
    return 25;
  }

  return Math.floor(value);
}

function normalizeMaxTriggerCount(value?: number | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function normalizeScheduledBotCount(value: number | string | undefined): number {
  const parsed = Math.floor(Number(value ?? 1));

  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
    throw new Error("Number of bots must be between 1 and 20.");
  }

  return parsed;
}

function hasReachedMaxTriggerCount(rule: {
  triggerCount: number;
  maxTriggerCount: number | null;
}): boolean {
  return (
    rule.maxTriggerCount !== null &&
    rule.maxTriggerCount > 0 &&
    rule.triggerCount >= rule.maxTriggerCount
  );
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeSenderMode(value: SenderMode | string | undefined): SenderMode {
  if (value === "specific_bots") {
    return "specific_bots";
  }

  if (value === "all_bots") {
    return "all_bots";
  }

  return "round_robin_bots";
}

function normalizeTimerTriggerSenderMode(
  value: TimerTriggerSenderMode | string | undefined,
): TimerTriggerSenderMode {
  if (value === "specific_bots" || value === "all_bots") {
    return value;
  }

  return "round_robin_bots";
}

function normalizeNextSenderIndex(
  value: number | null | undefined,
  senderBotCount: number,
): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed < 0 || senderBotCount <= 0) {
    return 0;
  }

  return Math.floor(parsed) % senderBotCount;
}

function normalizeNonNegativeInteger(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function paginateItems<T>(
  items: T[],
  options?: PaginationOptions,
): PaginatedResult<T> {
  const shouldPaginate =
    options?.page !== undefined || options?.pageSize !== undefined;
  const pageSize = shouldPaginate
    ? normalizePageSize(options?.pageSize)
    : Math.max(items.length, 1);
  const page = normalizePageNumber(options?.page);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages,
    },
  };
}

function sortTriggerRules(triggerRules: TriggerRule[]): TriggerRule[] {
  return [...triggerRules].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sortMeetingSessions(meetingSessions: MeetingSession[]): MeetingSession[] {
  return [...meetingSessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sortScheduledBotJoins(
  scheduledBotJoins: ScheduledBotJoin[],
): ScheduledBotJoin[] {
  return [...scheduledBotJoins].sort((a, b) => {
    const scheduledCompare = a.scheduledAt.localeCompare(b.scheduledAt);

    if (scheduledCompare !== 0) {
      return scheduledCompare;
    }

    return b.createdAt.localeCompare(a.createdAt);
  });
}

function sortTranscriptLogs(transcriptLogs: TranscriptLog[]): TranscriptLog[] {
  return [...transcriptLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sortMatchLogs(matchLogs: MatchLog[]): MatchLog[] {
  return [...matchLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function isUserVisibleMatchLog(matchLog: MatchLog): boolean {
  return (
    matchLog.status !== "skipped_dedupe" &&
    matchLog.status !== "skipped_duplicate_sender_execution"
  );
}

function sortWebhookDebugLogs(webhookDebugLogs: WebhookDebugLog[]): WebhookDebugLog[] {
  return [...webhookDebugLogs].sort((a, b) =>
    b.receivedAt.localeCompare(a.receivedAt),
  );
}

function sortRecallBots(recallBots: RecallBotRecord[]): RecallBotRecord[] {
  return [...recallBots].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sortTimerTriggers(timerTriggers: TimerTrigger[]): TimerTrigger[] {
  return [...timerTriggers].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sortTimerTriggerLogs(timerTriggerLogs: TimerTriggerLog[]): TimerTriggerLog[] {
  return [...timerTriggerLogs].sort((a, b) =>
    b.executedAt.localeCompare(a.executedAt),
  );
}

function sortLiveChatLogs(liveChatLogs: LiveChatLog[]): LiveChatLog[] {
  return [...liveChatLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function ensureTimerTriggerInput(input: {
  name: string;
  delayMinutesAfterJoin: number;
  message: string;
  senderMode: TimerTriggerSenderMode;
  senderBotIds: string[];
  responseDelaySeconds: number;
  maxTriggerCount?: number | null;
  enabled: boolean;
}): {
  name: string;
  delayMinutesAfterJoin: number;
  message: string;
  senderMode: TimerTriggerSenderMode;
  senderBotIds: string[];
  responseDelaySeconds: number;
  maxTriggerCount: number | null;
  enabled: boolean;
} {
  const name = input.name.trim();
  const message = input.message.trim();
  const senderMode = normalizeTimerTriggerSenderMode(input.senderMode);
  const senderBotIds =
    senderMode === "specific_bots"
      ? input.senderBotIds.map((botId) => botId.trim()).filter(Boolean)
      : [];
  const parsedDelayMinutesAfterJoin = Number(input.delayMinutesAfterJoin);
  const parsedResponseDelaySeconds = Number(input.responseDelaySeconds);

  if (!name) {
    throw new Error("Timer trigger name is required.");
  }

  if (!message) {
    throw new Error("Timer trigger message is required.");
  }

  return {
    name,
    delayMinutesAfterJoin: Number.isFinite(parsedDelayMinutesAfterJoin)
      ? Math.max(0, Math.floor(parsedDelayMinutesAfterJoin))
      : 0,
    message,
    senderMode,
    senderBotIds,
    responseDelaySeconds: Number.isFinite(parsedResponseDelaySeconds)
      ? Math.min(300, Math.max(0, Math.floor(parsedResponseDelaySeconds)))
      : 0,
    maxTriggerCount: normalizeMaxTriggerCount(input.maxTriggerCount),
    enabled: input.enabled,
  };
}

function ensureScheduledBotJoinInput(input: {
  name: string;
  scheduledAt: string;
  botCount: number;
  botNames?: string[];
  transcriptLanguage: string;
  enabled?: boolean;
}): {
  name: string;
  scheduledAt: string;
  botCount: number;
  botNames: string[];
  transcriptLanguage: string;
  enabled: boolean;
} {
  const name = input.name.trim();
  const transcriptLanguage = FIXED_TRANSCRIPT_LANGUAGE;

  if (!name) {
    throw new Error("Schedule name is required.");
  }

  const scheduledDate = new Date(input.scheduledAt);

  if (Number.isNaN(scheduledDate.getTime())) {
    throw new Error("Scheduled date and time are invalid.");
  }

  const botCount = normalizeScheduledBotCount(input.botCount);
  const providedBotNames = Array.isArray(input.botNames) ? input.botNames : [];

  if (providedBotNames.length !== botCount) {
    throw new Error("Number of bot names must match Number of Bots.");
  }

  const botNames = providedBotNames.map((botName, index) => {
    const trimmedBotName = String(botName ?? "").trim();

    if (!trimmedBotName) {
      throw new Error(`Bot ${index + 1} name is required.`);
    }

    return trimmedBotName;
  });

  return {
    name,
    scheduledAt: scheduledDate.toISOString(),
    botCount,
    botNames,
    transcriptLanguage,
    enabled: input.enabled ?? true,
  };
}

function ensureTriggerRuleInput(input: {
  triggerPhrase: string;
  replyMessage: string;
  cooldownSeconds: number;
  responseDelaySeconds: number;
  senderMode: SenderMode;
  senderBotIds: string[];
  maxTriggerCount?: number | null;
  enabled: boolean;
}): {
  triggerPhrase: string;
  normalizedTrigger: string;
  replyMessage: string;
  cooldownSeconds: number;
  responseDelaySeconds: number;
  senderMode: SenderMode;
  senderBotIds: string[];
  maxTriggerCount: number | null;
  enabled: boolean;
} {
  const triggerPhrase = input.triggerPhrase.trim();
  const replyMessage = input.replyMessage.trim();
  const parsedCooldownSeconds = Number(input.cooldownSeconds);
  const parsedResponseDelaySeconds = Number(input.responseDelaySeconds);
  const senderMode = normalizeSenderMode(input.senderMode);
  const cooldownSeconds = Number.isFinite(parsedCooldownSeconds)
    ? Math.max(0, Math.floor(parsedCooldownSeconds))
    : 0;
  const responseDelaySeconds = Number.isFinite(parsedResponseDelaySeconds)
    ? Math.min(300, Math.max(0, Math.floor(parsedResponseDelaySeconds)))
    : 0;
  const normalizedTrigger = normalizeTranscript(triggerPhrase);
  const senderBotIds =
    senderMode === "specific_bots"
      ? input.senderBotIds.map((botId) => botId.trim()).filter(Boolean)
      : [];
  const maxTriggerCount = normalizeMaxTriggerCount(input.maxTriggerCount);

  if (!triggerPhrase) {
    throw new Error("Trigger phrase is required.");
  }

  if (!replyMessage) {
    throw new Error("Reply message is required.");
  }

  if (!normalizedTrigger) {
    throw new Error("Trigger phrase must include letters or numbers.");
  }

  return {
    triggerPhrase,
    normalizedTrigger,
    replyMessage,
    cooldownSeconds,
    responseDelaySeconds,
    senderMode,
    senderBotIds,
    maxTriggerCount,
    enabled: input.enabled,
  };
}

function ensureValidSenderModeSelection(input: {
  recallBots: RecallBotRecord[];
  senderMode: SenderMode;
  senderBotIds: string[];
}): void {
  void input.recallBots;
  void input.senderMode;
  void input.senderBotIds;
}

function findEnabledDuplicateRule(
  triggerRules: TriggerRule[],
  normalizedTrigger: string,
  excludeId?: string,
): TriggerRule | undefined {
  return triggerRules.find(
    (rule) =>
      rule.id !== excludeId &&
      rule.enabled &&
      rule.normalizedTrigger === normalizedTrigger,
  );
}

function ensureNoDuplicateEnabledTriggerRule(input: {
  triggerRules: TriggerRule[];
  normalizedTrigger: string;
  enabled: boolean;
  excludeId?: string;
  currentRule?: TriggerRule;
}): void {
  if (!input.enabled) {
    return;
  }

  const duplicateRule = findEnabledDuplicateRule(
    input.triggerRules,
    input.normalizedTrigger,
    input.excludeId,
  );

  if (!duplicateRule) {
    return;
  }

  if (
    input.currentRule &&
    input.currentRule.enabled &&
    input.currentRule.normalizedTrigger === input.normalizedTrigger
  ) {
    return;
  }

  throw new Error("This trigger phrase already exists after normalization.");
}

export async function listTriggerRules(
  options?: TriggerRuleListOptions,
): Promise<PaginatedResult<TriggerRule>> {
  const store = await readStore();
  const search = normalizeSearchTerm(options?.search);
  const triggerSearch = normalizeSearchTerm(options?.triggerSearch);
  const replySearch = normalizeSearchTerm(options?.replySearch);
  const filteredRules = sortTriggerRules(store.triggerRules).filter((rule) => {
    if (!matchesSessionId(rule.sessionId, options?.sessionId)) {
      return false;
    }

    if (
      options?.status === "enabled" &&
      !rule.enabled
    ) {
      return false;
    }

    if (
      options?.status === "disabled" &&
      rule.enabled
    ) {
      return false;
    }

    if (
      triggerSearch &&
      !rule.triggerPhrase.toLowerCase().includes(triggerSearch)
    ) {
      return false;
    }

    if (
      replySearch &&
      !rule.replyMessage.toLowerCase().includes(replySearch)
    ) {
      return false;
    }

    return matchesSearch(search, [
      rule.triggerPhrase,
      rule.replyMessage,
      rule.normalizedTrigger,
    ]);
  });

  return paginateItems(filteredRules, options);
}

export async function createTriggerRule(input: {
  sessionId: string;
  triggerPhrase: string;
  replyMessage: string;
  cooldownSeconds: number;
  responseDelaySeconds: number;
  senderMode: SenderMode;
  senderBotIds: string[];
  maxTriggerCount?: number | null;
}): Promise<TriggerRule> {
  return mutateStore(async (store) => {
    const requestedSessionId = normalizeSessionIdInput(input.sessionId);
    const sessionId =
      findMeetingSessionById(store, requestedSessionId)?.id ??
      ensureDefaultSessionExists(store).id;
    const normalizedInput = ensureTriggerRuleInput({
      triggerPhrase: input.triggerPhrase,
      replyMessage: input.replyMessage,
      cooldownSeconds: input.cooldownSeconds,
      responseDelaySeconds: input.responseDelaySeconds,
      senderMode: input.senderMode,
      senderBotIds: input.senderBotIds,
      maxTriggerCount: input.maxTriggerCount,
      enabled: true,
    });

    ensureNoDuplicateEnabledTriggerRule({
      triggerRules: store.triggerRules.filter((rule) => rule.sessionId === sessionId),
      normalizedTrigger: normalizedInput.normalizedTrigger,
      enabled: normalizedInput.enabled,
    });
    ensureValidSenderModeSelection({
      recallBots: store.recallBots.filter((bot) => bot.sessionId === sessionId),
      senderMode: normalizedInput.senderMode,
      senderBotIds: normalizedInput.senderBotIds,
    });

    const rule: TriggerRule = {
      id: randomUUID(),
      sessionId,
      triggerPhrase: normalizedInput.triggerPhrase,
      normalizedTrigger: normalizedInput.normalizedTrigger,
      replyMessage: normalizedInput.replyMessage,
      cooldownSeconds: normalizedInput.cooldownSeconds,
      responseDelaySeconds: normalizedInput.responseDelaySeconds,
      senderMode: normalizedInput.senderMode,
      senderBotIds: normalizedInput.senderBotIds,
      nextSenderIndex: 0,
      triggerCount: 0,
      maxTriggerCount: normalizedInput.maxTriggerCount,
      enabled: normalizedInput.enabled,
      lastMatchedAt: null,
      lastTriggeredAt: null,
      createdAt: new Date().toISOString(),
    };

    store.triggerRules.unshift(rule);
    return rule;
  });
}

export async function updateTriggerRule(
  id: string,
  input: {
    triggerPhrase?: string;
    replyMessage?: string;
    cooldownSeconds?: number;
    responseDelaySeconds?: number;
    senderMode?: SenderMode;
    senderBotIds?: string[];
    maxTriggerCount?: number | null;
    enabled?: boolean;
  },
): Promise<TriggerRule> {
  return mutateStore(async (store) => {
    const rule = store.triggerRules.find((item) => item.id === id);

    if (!rule) {
      throw new Error("Trigger rule not found.");
    }

    const normalizedInput = ensureTriggerRuleInput({
      triggerPhrase: input.triggerPhrase ?? rule.triggerPhrase,
      replyMessage: input.replyMessage ?? rule.replyMessage,
      cooldownSeconds: input.cooldownSeconds ?? rule.cooldownSeconds,
      responseDelaySeconds:
        input.responseDelaySeconds ?? rule.responseDelaySeconds,
      senderMode: input.senderMode ?? rule.senderMode,
      senderBotIds: input.senderBotIds ?? rule.senderBotIds,
      maxTriggerCount:
        input.maxTriggerCount === undefined
          ? rule.maxTriggerCount
          : input.maxTriggerCount,
      enabled: input.enabled ?? rule.enabled,
    });

    ensureNoDuplicateEnabledTriggerRule({
      triggerRules: store.triggerRules.filter(
        (item) => item.sessionId === rule.sessionId,
      ),
      normalizedTrigger: normalizedInput.normalizedTrigger,
      enabled: normalizedInput.enabled,
      excludeId: id,
      currentRule: rule,
    });
    ensureValidSenderModeSelection({
      recallBots: store.recallBots.filter((bot) => bot.sessionId === rule.sessionId),
      senderMode: normalizedInput.senderMode,
      senderBotIds: normalizedInput.senderBotIds,
    });

    rule.triggerPhrase = normalizedInput.triggerPhrase;
    rule.normalizedTrigger = normalizedInput.normalizedTrigger;
    rule.replyMessage = normalizedInput.replyMessage;
    rule.cooldownSeconds = normalizedInput.cooldownSeconds;
    rule.responseDelaySeconds = normalizedInput.responseDelaySeconds;
    rule.senderMode = normalizedInput.senderMode;
    rule.senderBotIds = normalizedInput.senderBotIds;
    if (rule.senderMode === "round_robin_bots") {
      rule.nextSenderIndex = normalizeNonNegativeInteger(rule.nextSenderIndex);
    } else {
      rule.nextSenderIndex = 0;
    }
    rule.maxTriggerCount = normalizedInput.maxTriggerCount;
    rule.enabled = normalizedInput.enabled;

    return rule;
  });
}

export async function deleteTriggerRule(id: string): Promise<void> {
  await mutateStore(async (store) => {
    const initialCount = store.triggerRules.length;
    store.triggerRules = store.triggerRules.filter((rule) => rule.id !== id);

    if (store.triggerRules.length === initialCount) {
      throw new Error("Trigger rule not found.");
    }
  });
}

export async function clearTriggerRules(sessionId: string): Promise<number> {
  if (!sessionId.trim()) {
    throw new Error("Session ID is required.");
  }

  return mutateStore(async (store) => {
    const normalizedSessionId = normalizeSessionIdInput(sessionId);
    const initialCount = store.triggerRules.length;
    store.triggerRules = store.triggerRules.filter(
      (rule) => rule.sessionId !== normalizedSessionId,
    );

    return initialCount - store.triggerRules.length;
  });
}

export async function getLogs(sessionId?: string): Promise<{
  transcriptLogs: TranscriptLog[];
  matchLogs: MatchLog[];
  webhookDebugLogs: WebhookDebugLog[];
}> {
  const store = await readStore();

  return {
    transcriptLogs: sortTranscriptLogs(store.transcriptLogs).filter((log) =>
      matchesSessionId(log.sessionId, sessionId),
    ),
    matchLogs: sortMatchLogs(store.matchLogs).filter(
      (log) => isUserVisibleMatchLog(log) && matchesSessionId(log.sessionId, sessionId),
    ),
    webhookDebugLogs: sortWebhookDebugLogs(store.webhookDebugLogs).filter((log) =>
      matchesSessionId(log.sessionId, sessionId),
    ),
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  if (getStorageDriver() === "supabase") {
    const client = createSupabaseServiceRoleClient();
    const { data, error } = await client
      .from("settings")
      .select("storage_logging_mode")
      .eq("id", "app_settings")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return {
      storageLoggingMode: normalizeStorageLoggingMode(data?.storage_logging_mode),
    };
  }

  const store = await readStore();

  return {
    storageLoggingMode: store.storageLoggingMode,
  };
}

export async function getRecallBotByRecallBotId(
  recallBotId: string | null | undefined,
): Promise<RecallBotRecord | null> {
  const normalizedRecallBotId = recallBotId?.trim();

  if (!normalizedRecallBotId) {
    return null;
  }

  if (getStorageDriver() === "supabase") {
    const client = createSupabaseServiceRoleClient();
    const { data, error } = await client
      .from("recall_bots")
      .select("*")
      .eq("recall_bot_id", normalizedRecallBotId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return null;
    }

    return migrateRecallBotRecord({
      id: String(data.id),
      sessionId: String(data.session_id ?? ""),
      recallBotId: String(data.recall_bot_id ?? ""),
      meetingUrl: String(data.meeting_url ?? ""),
      botName: String(data.bot_name ?? ""),
      role: typeof data.role === "string" ? data.role : undefined,
      transcriptLanguage: String(data.transcript_language ?? ""),
      webhookUrl: String(data.webhook_url ?? ""),
      status: String(data.status ?? "created"),
      createdAt: String(data.created_at ?? new Date().toISOString()),
      joinedAt: typeof data.joined_at === "string" ? data.joined_at : null,
      lastStatusCheckedAt:
        typeof data.last_status_checked_at === "string"
          ? data.last_status_checked_at
          : null,
      lastErrorMessage:
        typeof data.last_error_message === "string"
          ? data.last_error_message
          : null,
      lastStopAttempt:
        data.last_stop_attempt &&
        typeof data.last_stop_attempt === "object" &&
        !Array.isArray(data.last_stop_attempt)
          ? (data.last_stop_attempt as RecallBotRecord["lastStopAttempt"])
          : null,
      createRequestPayload:
        data.create_request_payload &&
        typeof data.create_request_payload === "object" &&
        !Array.isArray(data.create_request_payload)
          ? (data.create_request_payload as Record<string, unknown>)
          : {},
      rawRecallResponse:
        data.raw_recall_response &&
        typeof data.raw_recall_response === "object" &&
        !Array.isArray(data.raw_recall_response)
          ? (data.raw_recall_response as Record<string, unknown>)
          : {},
    });
  }

  const store = await readStore();
  return (
    store.recallBots.find((bot) => bot.recallBotId === normalizedRecallBotId) ??
    null
  );
}

export async function listEnabledTriggerRulesBySession(
  sessionId: string,
): Promise<TriggerRule[]> {
  const normalizedSessionId = normalizeSessionIdInput(sessionId);

  if (getStorageDriver() === "supabase") {
    const client = createSupabaseServiceRoleClient();
    const { data, error } = await client
      .from("trigger_rules")
      .select("*")
      .eq("session_id", normalizedSessionId)
      .eq("enabled", true)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((rule) =>
      migrateTriggerRule({
        id: String(rule.id),
        sessionId: String(rule.session_id ?? ""),
        triggerPhrase: String(rule.trigger_phrase ?? ""),
        normalizedTrigger: String(rule.normalized_trigger ?? ""),
        replyMessage: String(rule.reply_message ?? ""),
        cooldownSeconds: Number(rule.cooldown_seconds ?? 0),
        responseDelaySeconds: Number(rule.response_delay_seconds ?? 0),
        senderMode: normalizeSenderMode(String(rule.sender_mode ?? "round_robin_bots")),
        senderBotIds: Array.isArray(rule.sender_bot_ids)
          ? rule.sender_bot_ids.map((botId: unknown) => String(botId))
          : [],
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
      }),
    );
  }

  const store = await readStore();
  return sortTriggerRules(store.triggerRules).filter(
    (rule) => rule.sessionId === normalizedSessionId && rule.enabled,
  );
}

export async function listActiveBotsBySession(
  sessionId: string,
): Promise<RecallBotRecord[]> {
  const normalizedSessionId = normalizeSessionIdInput(sessionId);

  if (getStorageDriver() === "supabase") {
    const client = createSupabaseServiceRoleClient();
    const { data, error } = await client
      .from("recall_bots")
      .select("*")
      .eq("session_id", normalizedSessionId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? [])
      .map((bot) =>
        migrateRecallBotRecord({
          id: String(bot.id),
          sessionId: String(bot.session_id ?? ""),
          recallBotId: String(bot.recall_bot_id ?? ""),
          meetingUrl: String(bot.meeting_url ?? ""),
          botName: String(bot.bot_name ?? ""),
          role: typeof bot.role === "string" ? bot.role : undefined,
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
              ? (bot.last_stop_attempt as RecallBotRecord["lastStopAttempt"])
              : null,
          createRequestPayload:
            bot.create_request_payload &&
            typeof bot.create_request_payload === "object" &&
            !Array.isArray(bot.create_request_payload)
              ? (bot.create_request_payload as Record<string, unknown>)
              : {},
          rawRecallResponse:
            bot.raw_recall_response &&
            typeof bot.raw_recall_response === "object" &&
            !Array.isArray(bot.raw_recall_response)
              ? (bot.raw_recall_response as Record<string, unknown>)
              : {},
        }),
      )
      .filter((bot) => isBotActiveStatus(bot.status));
  }

  const store = await readStore();
  return sortRecallBots(store.recallBots).filter(
    (bot) => bot.sessionId === normalizedSessionId && isBotActiveStatus(bot.status),
  );
}

export async function listMeetingSessions(): Promise<MeetingSession[]> {
  const store = await readStore();
  return sortMeetingSessions(store.meetingSessions);
}

export async function listScheduledBotJoins(
  options?: ScheduledBotJoinListOptions,
): Promise<PaginatedResult<ScheduledBotJoin>> {
  const store = await readStore();
  return paginateItems(
    sortScheduledBotJoins(store.scheduledBotJoins).filter((scheduledBotJoin) =>
      matchesSessionId(scheduledBotJoin.sessionId, options?.sessionId),
    ),
    options,
  );
}

export async function getRecallBotRecordByIdOrRecallBotId(
  idOrRecallBotId: string,
): Promise<RecallBotRecord | null> {
  const normalizedId = idOrRecallBotId.trim();

  if (!normalizedId) {
    return null;
  }

  const store = await readStore();
  return (
    store.recallBots.find(
      (record) =>
        record.id === normalizedId || record.recallBotId === normalizedId,
    ) ?? null
  );
}

export async function getMeetingSessionById(
  sessionId: string | undefined | null,
): Promise<MeetingSession | null> {
  const store = await readStore();
  return findMeetingSessionById(store, sessionId) ?? null;
}

export async function createScheduledBotJoin(input: {
  sessionId: string;
  name: string;
  scheduledAt: string;
  botCount: number;
  botNames: string[];
  transcriptLanguage: string;
  enabled?: boolean;
}): Promise<ScheduledBotJoin> {
  return mutateStore(async (store) => {
    const requestedSessionId = normalizeSessionIdInput(input.sessionId);
    const session =
      findMeetingSessionById(store, requestedSessionId) ??
      ensureDefaultSessionExists(store);
    const sessionBlockedMessage = getSessionOperationBlockedMessage(session.status);

    if (!session.zoomUrl.trim()) {
      throw new Error(
        "Selected session has no Zoom URL. Please add Zoom URL before scheduling bots.",
      );
    }

    if (sessionBlockedMessage) {
      throw new Error(sessionBlockedMessage);
    }

    const normalizedInput = ensureScheduledBotJoinInput({
      name: input.name,
      scheduledAt: input.scheduledAt,
      botCount: input.botCount,
      botNames: input.botNames,
      transcriptLanguage: input.transcriptLanguage,
      enabled: input.enabled,
    });
    const now = new Date().toISOString();
    const scheduledBotJoin: ScheduledBotJoin = {
      id: randomUUID(),
      sessionId: session.id,
      name: normalizedInput.name,
      enabled: normalizedInput.enabled,
      scheduledAt: normalizedInput.scheduledAt,
      botCount: normalizedInput.botCount,
      botNames: normalizedInput.botNames,
      transcriptLanguage: normalizedInput.transcriptLanguage,
      status: "pending",
      createdBotIds: [],
      lastRunAt: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    store.scheduledBotJoins.unshift(scheduledBotJoin);
    return scheduledBotJoin;
  });
}

export async function updateScheduledBotJoin(
  id: string,
  input: {
    sessionId?: string;
    name?: string;
    scheduledAt?: string;
    botCount?: number;
    botNames?: string[];
    transcriptLanguage?: string;
    enabled?: boolean;
    status?: ScheduledBotJoinStatus;
  },
): Promise<ScheduledBotJoin> {
  return mutateStore(async (store) => {
    const scheduledBotJoin = store.scheduledBotJoins.find((item) => item.id === id);

    if (!scheduledBotJoin) {
      throw new Error("Scheduled bot join not found.");
    }

    if (scheduledBotJoin.status === "running") {
      throw new Error("Cannot edit a scheduled bot join while it is running.");
    }

    if (input.status === "cancelled") {
      scheduledBotJoin.status = "cancelled";
      scheduledBotJoin.enabled = false;
      scheduledBotJoin.updatedAt = new Date().toISOString();
      return scheduledBotJoin;
    }

    const requestedSessionId = normalizeSessionIdInput(
      input.sessionId ?? scheduledBotJoin.sessionId,
    );
    const session =
      findMeetingSessionById(store, requestedSessionId) ??
      ensureDefaultSessionExists(store);
    const sessionBlockedMessage = getSessionOperationBlockedMessage(session.status);

    if (!session.zoomUrl.trim()) {
      throw new Error(
        "Selected session has no Zoom URL. Please add Zoom URL before scheduling bots.",
      );
    }

    if (sessionBlockedMessage) {
      throw new Error(sessionBlockedMessage);
    }

    const normalizedInput = ensureScheduledBotJoinInput({
      name: input.name ?? scheduledBotJoin.name,
      scheduledAt: input.scheduledAt ?? scheduledBotJoin.scheduledAt,
      botCount: input.botCount ?? scheduledBotJoin.botCount,
      botNames: input.botNames ?? scheduledBotJoin.botNames,
      transcriptLanguage:
        input.transcriptLanguage ?? scheduledBotJoin.transcriptLanguage,
      enabled: input.enabled ?? scheduledBotJoin.enabled,
    });

    const shouldResetExecutionState =
      input.sessionId !== undefined ||
      input.name !== undefined ||
      input.scheduledAt !== undefined ||
      input.botCount !== undefined ||
      input.botNames !== undefined ||
      input.transcriptLanguage !== undefined ||
      (input.enabled === true && scheduledBotJoin.status !== "pending");

    scheduledBotJoin.sessionId = session.id;
    scheduledBotJoin.name = normalizedInput.name;
    scheduledBotJoin.scheduledAt = normalizedInput.scheduledAt;
    scheduledBotJoin.botCount = normalizedInput.botCount;
    scheduledBotJoin.botNames = normalizedInput.botNames;
    scheduledBotJoin.transcriptLanguage = normalizedInput.transcriptLanguage;
    scheduledBotJoin.enabled = normalizedInput.enabled;

    if (shouldResetExecutionState) {
      scheduledBotJoin.status = "pending";
      scheduledBotJoin.createdBotIds = [];
      scheduledBotJoin.lastRunAt = null;
      scheduledBotJoin.errorMessage = null;
    }

    scheduledBotJoin.updatedAt = new Date().toISOString();
    return scheduledBotJoin;
  });
}

export async function deleteScheduledBotJoin(id: string): Promise<void> {
  await mutateStore(async (store) => {
    const initialCount = store.scheduledBotJoins.length;
    store.scheduledBotJoins = store.scheduledBotJoins.filter(
      (scheduledBotJoin) => scheduledBotJoin.id !== id,
    );

    if (store.scheduledBotJoins.length === initialCount) {
      throw new Error("Scheduled bot join not found.");
    }
  });
}

export async function createMeetingSession(input: {
  name: string;
  zoomUrl?: string;
  notes?: string;
}): Promise<MeetingSession> {
  return mutateStore(async (store) => {
    ensureDefaultSessionExists(store);
    const now = new Date().toISOString();
    const session: MeetingSession = {
      id: randomUUID(),
      name: input.name.trim() || "Untitled Session",
      zoomUrl: String(input.zoomUrl ?? "").trim(),
      notes: String(input.notes ?? "").trim(),
      status: "draft",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
    };

    store.meetingSessions.unshift(session);
    return session;
  });
}

export async function updateMeetingSession(
  id: string,
  input: {
    name?: string;
    zoomUrl?: string;
    notes?: string;
    status?: MeetingSessionStatus;
  },
): Promise<MeetingSession> {
  return mutateStore(async (store) => {
    ensureDefaultSessionExists(store);
    const session = store.meetingSessions.find((item) => item.id === id);

    if (!session) {
      throw new Error("Meeting session not found.");
    }

    const nextStatus =
      input.status !== undefined
        ? normalizeMeetingSessionStatus(input.status)
        : session.status;
    const updatedAt = new Date().toISOString();

    if (input.name !== undefined) {
      session.name = input.name.trim() || session.name;
    }

    if (input.zoomUrl !== undefined) {
      const nextZoomUrl = input.zoomUrl.trim();
      const hasActiveBots = store.recallBots.some(
        (bot) => bot.sessionId === session.id && isBotActiveStatus(bot.status),
      );

      if (hasActiveBots && nextZoomUrl !== session.zoomUrl) {
        throw new Error("Cannot change Zoom URL while this session has active bots.");
      }

      session.zoomUrl = input.zoomUrl.trim();
    }

    if (input.notes !== undefined) {
      session.notes = input.notes.trim();
    }

    if (nextStatus !== session.status) {
      if (nextStatus === "ended" || nextStatus === "archived") {
        const activeBots = store.recallBots.filter(
          (bot) => bot.sessionId === session.id && isBotActiveStatus(bot.status),
        );

        for (const bot of activeBots) {
          try {
            const stopStartedAt = new Date().toISOString();
            const stopResult = await stopRecallBot(bot.recallBotId);
            const stopAttempt = {
              endpoint: stopResult.endpoint,
              httpStatus: stopResult.httpStatus,
              attemptedAt: stopStartedAt,
              recallResponseBody: stopResult.responseBody,
              errorMessage: null,
            };

            try {
              const latestRecallResponse = await getRecallBot(bot.recallBotId);
              applyRecallBotRecordResponse(bot, {
                rawRecallResponse: latestRecallResponse,
                stopAttempt,
              });
            } catch (refreshError) {
              const refreshMessage =
                refreshError instanceof Error
                  ? refreshError.message
                  : "Failed to refresh bot status after stop.";

              applyRecallBotRecordError(bot, {
                errorMessage: `Stop command succeeded, but follow-up status refresh failed: ${refreshMessage}`,
                stopAttempt,
              });
            }
          } catch (stopError) {
            applyRecallBotRecordError(bot, {
              errorMessage:
                stopError instanceof Error
                  ? stopError.message
                  : "Failed to stop bot while ending session.",
            });
          }
        }

        for (const scheduledBotJoin of store.scheduledBotJoins) {
          if (
            scheduledBotJoin.sessionId === session.id &&
            scheduledBotJoin.status === "pending"
          ) {
            scheduledBotJoin.enabled = false;
            scheduledBotJoin.status = "cancelled";
            scheduledBotJoin.errorMessage =
              "Cancelled because the session was ended/archived.";
            scheduledBotJoin.updatedAt = updatedAt;
          }
        }
      }

      session.status = nextStatus;

      if (nextStatus === "active" && !session.startedAt) {
        session.startedAt = updatedAt;
      }

      if (nextStatus === "ended") {
        session.endedAt = updatedAt;
      }

      if (nextStatus === "active") {
        session.endedAt = null;
      }
    }

    session.updatedAt = updatedAt;

    return session;
  });
}

export async function deleteMeetingSession(id: string): Promise<void> {
  await mutateStore(async (store) => {
    const defaultSession = ensureDefaultSessionExists(store);
    const session = store.meetingSessions.find((item) => item.id === id);

    if (!session) {
      throw new Error("Meeting session not found.");
    }

    if (session.id === defaultSession.id) {
      throw new Error("Default Session cannot be deleted.");
    }

    const hasActiveBots = store.recallBots.some(
      (bot) => bot.sessionId === session.id && isBotActiveStatus(bot.status),
    );

    if (hasActiveBots) {
      throw new Error("Cannot delete a session that still has active bots.");
    }

    const reassignSessionId = defaultSession.id;
    store.recallBots = store.recallBots.map((bot) =>
      bot.sessionId === session.id ? { ...bot, sessionId: reassignSessionId } : bot,
    );
    store.triggerRules = store.triggerRules.map((rule) =>
      rule.sessionId === session.id ? { ...rule, sessionId: reassignSessionId } : rule,
    );
    store.timerTriggers = store.timerTriggers.map((trigger) =>
      trigger.sessionId === session.id
        ? { ...trigger, sessionId: reassignSessionId }
        : trigger,
    );
    store.matchLogs = store.matchLogs.map((log) =>
      log.sessionId === session.id ? { ...log, sessionId: reassignSessionId } : log,
    );
    store.timerTriggerLogs = store.timerTriggerLogs.map((log) =>
      log.sessionId === session.id ? { ...log, sessionId: reassignSessionId } : log,
    );
    store.liveChatLogs = store.liveChatLogs.map((log) =>
      log.sessionId === session.id ? { ...log, sessionId: reassignSessionId } : log,
    );
    store.webhookDebugLogs = store.webhookDebugLogs.map((log) =>
      log.sessionId === session.id ? { ...log, sessionId: reassignSessionId } : log,
    );
    store.transcriptLogs = store.transcriptLogs.map((log) =>
      log.sessionId === session.id ? { ...log, sessionId: reassignSessionId } : log,
    );
    store.meetingSessions = store.meetingSessions.filter((item) => item.id !== id);
  });
}

export async function updateAppSettings(input: {
  storageLoggingMode?: StorageLoggingMode;
}): Promise<AppSettings> {
  return mutateStore(async (store) => {
    if (input.storageLoggingMode !== undefined) {
      store.storageLoggingMode = normalizeStorageLoggingMode(
        input.storageLoggingMode,
      );
    }

    return {
      storageLoggingMode: store.storageLoggingMode,
    };
  });
}

function deriveRecallBotStatus(
  rawRecallResponse: Record<string, unknown>,
): string {
  if (typeof rawRecallResponse.status === "string") {
    return rawRecallResponse.status;
  }

  if (typeof rawRecallResponse.code === "string") {
    return rawRecallResponse.code;
  }

  const statusChanges = rawRecallResponse.status_changes;

  if (Array.isArray(statusChanges)) {
    for (let index = statusChanges.length - 1; index >= 0; index -= 1) {
      const entry = statusChanges[index];

      if (
        entry &&
        typeof entry === "object" &&
        "code" in entry &&
        typeof entry.code === "string"
      ) {
        return entry.code;
      }
    }
  }

  return "created";
}

function appendRecallBotRecordToStore(
  store: StoreData,
  input: {
    sessionId: string;
    meetingUrl: string;
    botName: string;
    role: RecallBotRole;
    transcriptLanguage: string;
    createRequestPayload: Record<string, unknown>;
    rawRecallResponse: Record<string, unknown>;
  },
): RecallBotRecord {
  const recallBotId = String(input.rawRecallResponse.id ?? "").trim();

  if (!recallBotId) {
    throw new Error("Recall create bot response did not include a bot ID.");
  }

  const webhookUrl = getRecallWebhookUrl();
  const requestedSessionId = normalizeSessionIdInput(input.sessionId);
  const sessionId =
    findMeetingSessionById(store, requestedSessionId)?.id ??
    ensureDefaultSessionExists(store).id;
  const record: RecallBotRecord = {
    id: randomUUID(),
    sessionId,
    recallBotId,
    meetingUrl: input.meetingUrl,
    botName: input.botName,
    role: input.role,
    transcriptLanguage: input.transcriptLanguage,
    webhookUrl,
    status: deriveRecallBotStatus(input.rawRecallResponse),
    createdAt: new Date().toISOString(),
    joinedAt: null,
    lastStatusCheckedAt: new Date().toISOString(),
    lastErrorMessage: null,
    lastStopAttempt: null,
    createRequestPayload: input.createRequestPayload,
    rawRecallResponse: input.rawRecallResponse,
  };

  store.recallBots.unshift(record);
  if (store.recallBots.length > 100) {
    store.recallBots = store.recallBots.slice(0, 100);
  }

  return record;
}

function applyRecallBotRecordResponse(
  record: RecallBotRecord,
  input: {
    rawRecallResponse: Record<string, unknown>;
    checkedAt?: string;
    errorMessage?: string | null;
    stopAttempt?: RecallBotRecord["lastStopAttempt"];
  },
): RecallBotRecord {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const nextStatus = deriveRecallBotStatus(input.rawRecallResponse);

  record.status = nextStatus;
  setRecallBotJoinedAtIfNeeded(record, nextStatus, checkedAt);
  record.lastStatusCheckedAt = checkedAt;
  record.lastErrorMessage = input.errorMessage ?? null;

  if (input.stopAttempt !== undefined) {
    record.lastStopAttempt = input.stopAttempt;
  }

  record.rawRecallResponse = input.rawRecallResponse;

  return record;
}

function applyRecallBotRecordError(
  record: RecallBotRecord,
  input: {
    errorMessage: string;
    stopAttempt?: RecallBotRecord["lastStopAttempt"];
  },
): RecallBotRecord {
  record.lastStatusCheckedAt = new Date().toISOString();
  record.lastErrorMessage = input.errorMessage;

  if (input.stopAttempt !== undefined) {
    record.lastStopAttempt = input.stopAttempt;
  }

  return record;
}

function getBotRoleForCreationIndex(index: number): RecallBotRole {
  return index === 0 ? "listener" : "sender";
}

function setRecallBotJoinedAtIfNeeded(
  record: RecallBotRecord,
  nextStatus: string,
  checkedAt: string,
): void {
  if (!record.joinedAt && isBotInCallStatus(nextStatus)) {
    record.joinedAt = checkedAt;
  }
}

export async function listRecallBots(
  options?: RecallBotListOptions,
): Promise<PaginatedResult<RecallBotRecord>> {
  const store = await readStore();
  const search = normalizeSearchTerm(options?.search);
  const botIdSearch = normalizeSearchTerm(options?.botId);
  const nameSearch = normalizeSearchTerm(options?.name);
  const meetingUrlSearch = normalizeSearchTerm(options?.meetingUrl);
  const filteredBots = sortRecallBots(store.recallBots).filter((bot) => {
    if (!matchesSessionId(bot.sessionId, options?.sessionId)) {
      return false;
    }

    if (options?.status && bot.status !== options.status) {
      return false;
    }

    if (botIdSearch && !bot.recallBotId.toLowerCase().includes(botIdSearch)) {
      return false;
    }

    if (nameSearch && !bot.botName.toLowerCase().includes(nameSearch)) {
      return false;
    }

    if (
      meetingUrlSearch &&
      !bot.meetingUrl.toLowerCase().includes(meetingUrlSearch)
    ) {
      return false;
    }

    return matchesSearch(search, [
      bot.botName,
      bot.meetingUrl,
      bot.recallBotId,
      bot.status,
    ]);
  });

  return paginateItems(filteredBots, options);
}

export async function deleteRecallBotRecord(id: string): Promise<void> {
  await mutateStore(async (store) => {
    const bot = store.recallBots.find((item) => item.id === id);

    if (!bot) {
      throw new Error("Bot record not found.");
    }

    if (isBotActiveStatus(bot.status)) {
      throw new Error("Active bot records cannot be deleted.");
    }

    store.recallBots = store.recallBots.filter((item) => item.id !== id);
  });
}

export async function clearRecallBotHistory(sessionId?: string): Promise<{ removedCount: number }> {
  return mutateStore(async (store) => {
    const removableBots = store.recallBots.filter(
      (bot) =>
        !isBotActiveStatus(bot.status) &&
        matchesSessionId(bot.sessionId, sessionId),
    );

    store.recallBots = store.recallBots.filter((bot) =>
      isBotActiveStatus(bot.status) || !matchesSessionId(bot.sessionId, sessionId),
    );

    return {
      removedCount: removableBots.length,
    };
  });
}

export async function listTimerTriggers(
  options?: TimerTriggerListOptions,
): Promise<PaginatedResult<TimerTrigger>> {
  const store = await readStore();
  return paginateItems(
    sortTimerTriggers(store.timerTriggers).filter((trigger) =>
      matchesSessionId(trigger.sessionId, options?.sessionId),
    ),
    options,
  );
}

export async function createTimerTrigger(input: {
  sessionId: string;
  name: string;
  delayMinutesAfterJoin: number;
  message: string;
  senderMode: TimerTriggerSenderMode;
  senderBotIds: string[];
  responseDelaySeconds: number;
  maxTriggerCount?: number | null;
  enabled?: boolean;
}): Promise<TimerTrigger> {
  return mutateStore(async (store) => {
    const requestedSessionId = normalizeSessionIdInput(input.sessionId);
    const session =
      findMeetingSessionById(store, requestedSessionId) ??
      ensureDefaultSessionExists(store);
    const sessionBlockedMessage = getSessionOperationBlockedMessage(session.status);

    if (sessionBlockedMessage) {
      throw new Error(sessionBlockedMessage);
    }

    const sessionId = session.id;
    const normalizedInput = ensureTimerTriggerInput({
      name: input.name,
      delayMinutesAfterJoin: input.delayMinutesAfterJoin,
      message: input.message,
      senderMode: input.senderMode,
      senderBotIds: input.senderBotIds,
      responseDelaySeconds: input.responseDelaySeconds,
      maxTriggerCount: input.maxTriggerCount,
      enabled: input.enabled ?? true,
    });
    const now = new Date().toISOString();
    const timerTrigger: TimerTrigger = {
      id: randomUUID(),
      sessionId,
      name: normalizedInput.name,
      enabled: normalizedInput.enabled,
      delayMinutesAfterJoin: normalizedInput.delayMinutesAfterJoin,
      message: normalizedInput.message,
      senderMode: normalizedInput.senderMode,
      senderBotIds: normalizedInput.senderBotIds,
      nextSenderIndex: 0,
      responseDelaySeconds: normalizedInput.responseDelaySeconds,
      maxTriggerCount: normalizedInput.maxTriggerCount,
      triggerCount: 0,
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
    };

    store.timerTriggers.unshift(timerTrigger);
    return timerTrigger;
  });
}

export async function updateTimerTrigger(
  id: string,
  input: {
    name?: string;
    delayMinutesAfterJoin?: number;
    message?: string;
    senderMode?: TimerTriggerSenderMode;
    senderBotIds?: string[];
    responseDelaySeconds?: number;
    maxTriggerCount?: number | null;
    enabled?: boolean;
  },
): Promise<TimerTrigger> {
  return mutateStore(async (store) => {
    const timerTrigger = store.timerTriggers.find((item) => item.id === id);

    if (!timerTrigger) {
      throw new Error("Timer trigger not found.");
    }

    const normalizedInput = ensureTimerTriggerInput({
      name: input.name ?? timerTrigger.name,
      delayMinutesAfterJoin:
        input.delayMinutesAfterJoin ?? timerTrigger.delayMinutesAfterJoin,
      message: input.message ?? timerTrigger.message,
      senderMode: input.senderMode ?? timerTrigger.senderMode,
      senderBotIds: input.senderBotIds ?? timerTrigger.senderBotIds,
      responseDelaySeconds:
        input.responseDelaySeconds ?? timerTrigger.responseDelaySeconds,
      maxTriggerCount:
        input.maxTriggerCount === undefined
          ? timerTrigger.maxTriggerCount
          : input.maxTriggerCount,
      enabled: input.enabled ?? timerTrigger.enabled,
    });

    timerTrigger.name = normalizedInput.name;
    timerTrigger.enabled = normalizedInput.enabled;
    timerTrigger.delayMinutesAfterJoin = normalizedInput.delayMinutesAfterJoin;
    timerTrigger.message = normalizedInput.message;
    timerTrigger.senderMode = normalizedInput.senderMode;
    timerTrigger.senderBotIds = normalizedInput.senderBotIds;
    if (timerTrigger.senderMode === "round_robin_bots") {
      timerTrigger.nextSenderIndex = normalizeNonNegativeInteger(
        timerTrigger.nextSenderIndex,
      );
    } else {
      timerTrigger.nextSenderIndex = 0;
    }
    timerTrigger.responseDelaySeconds = normalizedInput.responseDelaySeconds;
    timerTrigger.maxTriggerCount = normalizedInput.maxTriggerCount;
    timerTrigger.updatedAt = new Date().toISOString();

    return timerTrigger;
  });
}

export async function deleteTimerTrigger(id: string): Promise<void> {
  await mutateStore(async (store) => {
    const initialCount = store.timerTriggers.length;
    store.timerTriggers = store.timerTriggers.filter(
      (trigger) => trigger.id !== id,
    );

    if (store.timerTriggers.length === initialCount) {
      throw new Error("Timer trigger not found.");
    }
  });
}

export async function clearTimerTriggers(sessionId: string): Promise<number> {
  if (!sessionId.trim()) {
    throw new Error("Session ID is required.");
  }

  return mutateStore(async (store) => {
    const normalizedSessionId = normalizeSessionIdInput(sessionId);
    const initialCount = store.timerTriggers.length;
    store.timerTriggers = store.timerTriggers.filter(
      (trigger) => trigger.sessionId !== normalizedSessionId,
    );

    return initialCount - store.timerTriggers.length;
  });
}

export async function listTimerTriggerLogs(
  options?: TimerTriggerLogListOptions,
): Promise<PaginatedResult<TimerTriggerLog>> {
  const store = await readStore();
  return paginateItems(
    sortTimerTriggerLogs(store.timerTriggerLogs).filter((log) =>
      matchesSessionId(log.sessionId, options?.sessionId),
    ),
    options,
  );
}

export async function deleteTimerTriggerLog(id: string): Promise<void> {
  await mutateStore(async (store) => {
    const initialCount = store.timerTriggerLogs.length;
    store.timerTriggerLogs = store.timerTriggerLogs.filter(
      (log) => log.id !== id,
    );

    if (store.timerTriggerLogs.length === initialCount) {
      throw new Error("Timer trigger log not found.");
    }
  });
}

export async function clearTimerTriggerLogs(sessionId?: string): Promise<void> {
  await mutateStore(async (store) => {
    store.timerTriggerLogs = store.timerTriggerLogs.filter(
      (log) => !matchesSessionId(log.sessionId, sessionId),
    );
  });
}

export async function listLiveChatLogs(
  options?: LiveChatLogListOptions,
): Promise<PaginatedResult<LiveChatLog>> {
  const store = await readStore();
  return paginateItems(
    sortLiveChatLogs(store.liveChatLogs).filter((log) =>
      matchesSessionId(log.sessionId, options?.sessionId),
    ),
    options,
  );
}

export async function deleteLiveChatLog(id: string): Promise<void> {
  await mutateStore(async (store) => {
    const initialCount = store.liveChatLogs.length;
    store.liveChatLogs = store.liveChatLogs.filter((log) => log.id !== id);

    if (store.liveChatLogs.length === initialCount) {
      throw new Error("Live chat log not found.");
    }
  });
}

export async function clearLiveChatLogs(sessionId?: string): Promise<void> {
  await mutateStore(async (store) => {
    store.liveChatLogs = store.liveChatLogs.filter(
      (log) => !matchesSessionId(log.sessionId, sessionId),
    );
  });
}

export async function listTranscriptLogs(
  options?: TranscriptLogListOptions,
): Promise<PaginatedResult<TranscriptLog>> {
  const store = await readStore();
  const search = normalizeSearchTerm(options?.search);
  const botIdSearch = normalizeSearchTerm(options?.botId);
  const filteredLogs = sortTranscriptLogs(store.transcriptLogs).filter((log) => {
    if (!matchesSessionId(log.sessionId, options?.sessionId)) {
      return false;
    }

    if (botIdSearch && !(log.botId ?? "").toLowerCase().includes(botIdSearch)) {
      return false;
    }

    return matchesSearch(search, [
      log.transcriptText,
      log.normalizedTranscriptText,
    ]);
  });

  return paginateItems(filteredLogs, options);
}

export async function listMatchedTriggerLogs(
  options?: MatchLogListOptions,
): Promise<PaginatedResult<MatchLog>> {
  const store = await readStore();
  const search = normalizeSearchTerm(options?.search);
  const botIdSearch = normalizeSearchTerm(options?.botId);
  const triggerSearch = normalizeSearchTerm(options?.triggerSearch);
  const replySearch = normalizeSearchTerm(options?.replySearch);
  const filteredLogs = sortMatchLogs(store.matchLogs).filter((log) => {
    if (!matchesSessionId(log.sessionId, options?.sessionId)) {
      return false;
    }

    if (!isUserVisibleMatchLog(log)) {
      return false;
    }

    if (options?.status && log.status !== options.status) {
      const hasMatchingSenderStatus = log.senderResults.some(
        (senderResult) => senderResult.status === options.status,
      );

      if (!hasMatchingSenderStatus) {
        return false;
      }
    }

    const matchesBotId =
      (log.botId ?? "").toLowerCase().includes(botIdSearch) ||
      (log.sourceWebhookBotId ?? "").toLowerCase().includes(botIdSearch) ||
      log.senderBotIdsUsed.some((senderBotId) =>
        senderBotId.toLowerCase().includes(botIdSearch),
      ) ||
      log.originalSenderBotIds.some((senderBotId) =>
        senderBotId.toLowerCase().includes(botIdSearch),
      ) ||
      log.dedupedSenderBotIds.some((senderBotId) =>
        senderBotId.toLowerCase().includes(botIdSearch),
      );

    if (botIdSearch && !matchesBotId) {
      return false;
    }

    if (
      triggerSearch &&
      !log.triggerPhrase.toLowerCase().includes(triggerSearch)
    ) {
      return false;
    }

    if (
      replySearch &&
      !log.replyMessage.toLowerCase().includes(replySearch)
    ) {
      return false;
    }

    return matchesSearch(search, [
      log.triggerPhrase,
      log.replyMessage,
      log.action,
      log.triggerExecutionId,
      log.sourceEvent,
      log.sourceWebhookBotId,
      log.chosenRoundRobinBotId,
      log.chosenRoundRobinBotName,
      ...log.senderBotIdsUsed,
      ...log.originalSenderBotIds,
      ...log.dedupedSenderBotIds,
      ...log.warningMessages,
      ...log.senderResults.flatMap((senderResult) => [
        senderResult.senderBotId,
        senderResult.senderBotName,
        senderResult.action,
      ]),
    ]);
  });

  return paginateItems(filteredLogs, options);
}

export async function listWebhookDebugLogs(
  options?: WebhookDebugLogListOptions,
): Promise<PaginatedResult<WebhookDebugLog>> {
  const store = await readStore();
  const search = normalizeSearchTerm(options?.search);
  const botIdSearch = normalizeSearchTerm(options?.botId);
  const filteredLogs = sortWebhookDebugLogs(store.webhookDebugLogs).filter((log) => {
    if (!matchesSessionId(log.sessionId, options?.sessionId)) {
      return false;
    }

    if (options?.event && log.eventName !== options.event) {
      return false;
    }

    if (options?.status && log.status !== options.status) {
      return false;
    }

    if (botIdSearch && !(log.botId ?? "").toLowerCase().includes(botIdSearch)) {
      return false;
    }

    return matchesSearch(search, [log.extractedTranscriptText]);
  });

  return paginateItems(filteredLogs, options);
}

export async function saveRecallBotRecord(input: {
  sessionId: string;
  meetingUrl: string;
  botName: string;
  role: RecallBotRole;
  transcriptLanguage: string;
  createRequestPayload: Record<string, unknown>;
  rawRecallResponse: Record<string, unknown>;
}): Promise<RecallBotRecord> {
  return mutateStore(async (store) => {
    return appendRecallBotRecordToStore(store, input);
  });
}

export async function updateRecallBotRecordFromResponse(input: {
  recallBotId: string;
  rawRecallResponse: Record<string, unknown>;
  checkedAt?: string;
  errorMessage?: string | null;
  stopAttempt?: RecallBotRecord["lastStopAttempt"];
}): Promise<RecallBotRecord> {
  return mutateStore(async (store) => {
    const record = store.recallBots.find(
      (item) => item.recallBotId === input.recallBotId,
    );

    if (!record) {
      throw new Error("Created bot record not found.");
    }

    return applyRecallBotRecordResponse(record, input);
  });
}

export async function updateRecallBotRecordError(input: {
  recallBotId: string;
  errorMessage: string;
  stopAttempt?: RecallBotRecord["lastStopAttempt"];
}): Promise<RecallBotRecord> {
  return mutateStore(async (store) => {
    const record = store.recallBots.find(
      (item) => item.recallBotId === input.recallBotId,
    );

    if (!record) {
      throw new Error("Created bot record not found.");
    }

    return applyRecallBotRecordError(record, input);
  });
}

function buildSenderTargets(input: {
  matchedRule: TriggerRule;
  webhookBotId: string | null;
  recallBots: RecallBotRecord[];
}): SenderTargetBuildResult {
  const originalSenderBotIds =
    input.matchedRule.senderMode === "specific_bots"
      ? input.matchedRule.senderBotIds
      : input.recallBots
          .filter((bot) => isBotActiveStatus(bot.status))
          .map((bot) => bot.recallBotId);
  const dedupedSenderBotIds = [...new Set(originalSenderBotIds)];
  const warningMessages: string[] = [];
  let chosenRoundRobinBotId: string | null = null;
  let chosenRoundRobinBotName: string | null = null;
  let previousRoundRobinIndex: number | null = null;
  let nextRoundRobinIndex: number | null = null;

  if (dedupedSenderBotIds.length !== originalSenderBotIds.length) {
    warningMessages.push(
      `Duplicate sender bot IDs were detected and deduped for rule "${input.matchedRule.triggerPhrase}".`,
    );
  }

  const senderTargets: SenderTarget[] =
    input.matchedRule.senderMode === "specific_bots"
      ? dedupedSenderBotIds.length === 0
        ? [
            {
              senderBotId: null,
              senderBotName: null,
              isAvailable: false,
              errorMessage: "no_active_sender_bot",
            },
          ]
        : dedupedSenderBotIds.map((senderBotId) => {
            const senderBot = input.recallBots.find(
              (bot) => bot.recallBotId === senderBotId,
            );

            if (!senderBot) {
              return {
                senderBotId,
                senderBotName: null,
                isAvailable: false,
                errorMessage: "Selected sender bot is missing from local storage.",
              };
            }

            if (!isBotActiveStatus(senderBot.status)) {
              return {
                senderBotId,
                senderBotName: senderBot.botName,
                isAvailable: false,
                errorMessage: "Selected sender bot is not active.",
              };
            }

            return {
              senderBotId,
              senderBotName: senderBot.botName,
              isAvailable: true,
              errorMessage: null,
            };
          })
      : input.matchedRule.senderMode === "round_robin_bots"
        ? (() => {
            if (dedupedSenderBotIds.length === 0) {
              previousRoundRobinIndex = 0;
              nextRoundRobinIndex = 0;

              return [
                {
                  senderBotId: null,
                  senderBotName: null,
                  isAvailable: false,
                  errorMessage: "no_active_sender_bot",
                },
              ];
            }

            previousRoundRobinIndex = normalizeNextSenderIndex(
              input.matchedRule.nextSenderIndex,
              dedupedSenderBotIds.length,
            );
            nextRoundRobinIndex = previousRoundRobinIndex;

            for (let offset = 0; offset < dedupedSenderBotIds.length; offset += 1) {
              const senderIndex =
                (previousRoundRobinIndex + offset) % dedupedSenderBotIds.length;
              const senderBotId = dedupedSenderBotIds[senderIndex];
              const senderBot = input.recallBots.find(
                (bot) => bot.recallBotId === senderBotId,
              );

              if (!senderBot || !isBotActiveStatus(senderBot.status)) {
                continue;
              }

              chosenRoundRobinBotId = senderBot.recallBotId;
              chosenRoundRobinBotName = senderBot.botName;
              nextRoundRobinIndex = (senderIndex + 1) % dedupedSenderBotIds.length;

              if (offset > 0) {
                warningMessages.push(
                  `Round-robin skipped ${offset} missing or inactive sender bot(s) before choosing ${senderBot.botName} (${senderBot.recallBotId}).`,
                );
              }

              return [
                {
                  senderBotId: senderBot.recallBotId,
                  senderBotName: senderBot.botName,
                  isAvailable: true,
                  errorMessage: null,
                },
              ];
            }

            warningMessages.push(
              `Round-robin could not find an active sender bot for rule "${input.matchedRule.triggerPhrase}".`,
            );

            return [
              {
                senderBotId: null,
                senderBotName: null,
                isAvailable: false,
                errorMessage: "no_active_sender_bot",
              },
            ];
          })()
      : input.matchedRule.senderMode === "all_bots"
        ? dedupedSenderBotIds.length === 0
          ? [
              {
                senderBotId: null,
                senderBotName: null,
                isAvailable: false,
                errorMessage: "no_active_sender_bot",
              },
            ]
          : dedupedSenderBotIds.map((senderBotId) => {
              const senderBot = input.recallBots.find(
                (bot) => bot.recallBotId === senderBotId,
              );

              if (!senderBot || !isBotActiveStatus(senderBot.status)) {
                return {
                  senderBotId,
                  senderBotName: senderBot?.botName ?? null,
                  isAvailable: false,
                  errorMessage: "Selected sender bot is not active.",
                };
              }

              return {
                senderBotId: senderBot.recallBotId,
                senderBotName: senderBot.botName,
                isAvailable: true,
                errorMessage: null,
              };
            })
      : [];

  return {
    senderTargets,
    originalSenderBotIds,
    dedupedSenderBotIds,
    warningMessages,
    chosenRoundRobinBotId,
    chosenRoundRobinBotName,
    previousRoundRobinIndex,
    nextRoundRobinIndex,
  };
}

function buildTimerTriggerSenderTargets(input: {
  timerTrigger: TimerTrigger;
  recallBots: RecallBotRecord[];
}): {
  senderTargets: SenderTarget[];
  senderBotIdsUsed: string[];
  senderBotIdUsed: string | null;
} {
  const activeBots = input.recallBots.filter((bot) => isBotActiveStatus(bot.status));
  const uniqueActiveBots = activeBots.filter(
    (bot, index, allBots) =>
      allBots.findIndex(
        (candidate) => candidate.recallBotId === bot.recallBotId,
      ) === index,
  );

  if (input.timerTrigger.senderMode === "specific_bots") {
    const dedupedSenderBotIds = [...new Set(input.timerTrigger.senderBotIds)];

    if (dedupedSenderBotIds.length === 0) {
      return {
        senderTargets: [
          {
            senderBotId: null,
            senderBotName: null,
            isAvailable: false,
            errorMessage: "no_active_sender_bot",
          },
        ],
        senderBotIdsUsed: [],
        senderBotIdUsed: null,
      };
    }

    const senderTargets = dedupedSenderBotIds.map((senderBotId) => {
      const senderBot = input.recallBots.find(
        (bot) => bot.recallBotId === senderBotId,
      );

      if (!senderBot) {
        return {
          senderBotId,
          senderBotName: null,
          isAvailable: false,
          errorMessage: "Selected sender bot is missing from local storage.",
        };
      }

      if (!isBotActiveStatus(senderBot.status)) {
        return {
          senderBotId,
          senderBotName: senderBot.botName,
          isAvailable: false,
          errorMessage: "Selected sender bot is not active.",
        };
      }

      return {
        senderBotId,
        senderBotName: senderBot.botName,
        isAvailable: true,
        errorMessage: null,
      };
    });
    const senderBotIdsUsed = senderTargets
      .map((senderTarget) => senderTarget.senderBotId)
      .filter((senderBotId): senderBotId is string => Boolean(senderBotId));

    return {
      senderTargets,
      senderBotIdsUsed,
      senderBotIdUsed: senderBotIdsUsed[0] ?? null,
    };
  }

  if (uniqueActiveBots.length === 0) {
    return {
      senderTargets: [
        {
          senderBotId: null,
          senderBotName: null,
          isAvailable: false,
          errorMessage: "no_active_sender_bot",
        },
      ],
      senderBotIdsUsed: [],
      senderBotIdUsed: null,
    };
  }

  if (input.timerTrigger.senderMode === "all_bots") {
    return {
      senderTargets: uniqueActiveBots.map((senderBot) => ({
        senderBotId: senderBot.recallBotId,
        senderBotName: senderBot.botName,
        isAvailable: true,
        errorMessage: null,
      })),
      senderBotIdsUsed: uniqueActiveBots.map((senderBot) => senderBot.recallBotId),
      senderBotIdUsed: uniqueActiveBots[0]?.recallBotId ?? null,
    };
  }

  const senderIndex = normalizeNextSenderIndex(
    input.timerTrigger.nextSenderIndex,
    uniqueActiveBots.length,
  );
  const senderBot = uniqueActiveBots[senderIndex];

  return {
    senderTargets: [
      {
        senderBotId: senderBot.recallBotId,
        senderBotName: senderBot.botName,
        isAvailable: true,
        errorMessage: null,
      },
    ],
    senderBotIdsUsed: [senderBot.recallBotId],
    senderBotIdUsed: senderBot.recallBotId,
  };
}

function buildLiveChatSenderTargets(input: {
  senderMode: SenderMode;
  senderBotIds: string[];
  recallBots: RecallBotRecord[];
  roundRobinIndex: number;
}): {
  senderTargets: SenderTarget[];
  senderBotIdsUsed: string[];
  chosenRoundRobinBotId: string | null;
  nextRoundRobinIndex: number;
} {
  const activeBots = input.recallBots.filter((bot) => isBotActiveStatus(bot.status));
  const uniqueActiveBots = activeBots.filter(
    (bot, index, allBots) =>
      allBots.findIndex(
        (candidate) => candidate.recallBotId === bot.recallBotId,
      ) === index,
  );

  if (input.senderMode === "specific_bots") {
    const dedupedSenderBotIds = [...new Set(input.senderBotIds)];

    if (dedupedSenderBotIds.length === 0) {
      return {
        senderTargets: [
          {
            senderBotId: null,
            senderBotName: null,
            isAvailable: false,
            errorMessage: "no_active_sender_bot",
          },
        ],
        senderBotIdsUsed: [],
        chosenRoundRobinBotId: null,
        nextRoundRobinIndex: input.roundRobinIndex,
      };
    }

    const senderTargets = dedupedSenderBotIds.map((senderBotId) => {
      const senderBot = input.recallBots.find(
        (bot) => bot.recallBotId === senderBotId,
      );

      if (!senderBot) {
        return {
          senderBotId,
          senderBotName: null,
          isAvailable: false,
          errorMessage: "Selected sender bot is missing from local storage.",
        };
      }

      if (!isBotActiveStatus(senderBot.status)) {
        return {
          senderBotId,
          senderBotName: senderBot.botName,
          isAvailable: false,
          errorMessage: "Selected sender bot is not active.",
        };
      }

      return {
        senderBotId,
        senderBotName: senderBot.botName,
        isAvailable: true,
        errorMessage: null,
      };
    });

    return {
      senderTargets,
      senderBotIdsUsed: senderTargets
        .map((senderTarget) => senderTarget.senderBotId)
        .filter((senderBotId): senderBotId is string => Boolean(senderBotId)),
      chosenRoundRobinBotId: null,
      nextRoundRobinIndex: input.roundRobinIndex,
    };
  }

  if (uniqueActiveBots.length === 0) {
    return {
      senderTargets: [
        {
          senderBotId: null,
          senderBotName: null,
          isAvailable: false,
          errorMessage: "no_active_sender_bot",
        },
      ],
      senderBotIdsUsed: [],
      chosenRoundRobinBotId: null,
      nextRoundRobinIndex: input.roundRobinIndex,
    };
  }

  if (input.senderMode === "all_bots") {
    return {
      senderTargets: uniqueActiveBots.map((senderBot) => ({
        senderBotId: senderBot.recallBotId,
        senderBotName: senderBot.botName,
        isAvailable: true,
        errorMessage: null,
      })),
      senderBotIdsUsed: uniqueActiveBots.map((senderBot) => senderBot.recallBotId),
      chosenRoundRobinBotId: null,
      nextRoundRobinIndex: input.roundRobinIndex,
    };
  }

  const senderIndex = normalizeNextSenderIndex(
    input.roundRobinIndex,
    uniqueActiveBots.length,
  );
  const senderBot = uniqueActiveBots[senderIndex];

  return {
    senderTargets: [
      {
        senderBotId: senderBot.recallBotId,
        senderBotName: senderBot.botName,
        isAvailable: true,
        errorMessage: null,
      },
    ],
    senderBotIdsUsed: [senderBot.recallBotId],
    chosenRoundRobinBotId: senderBot.recallBotId,
    nextRoundRobinIndex: normalizeNonNegativeInteger(senderIndex + 1),
  };
}

async function executeSenderTargets(input: {
  triggerExecutionId: string;
  senderTargets: SenderTarget[];
  replyMessage: string;
  sendChatEnabled: boolean;
}): Promise<{
  senderResults: MatchSenderResult[];
  sendAttemptCount: number;
  actualSendCount: number;
}> {
  const sentExecutionKeys = new Set<string>();
  const senderResultsByIndex = new Map<number, MatchSenderResult>();
  let sendAttemptCount = 0;
  let actualSendCount = 0;
  const sendTasks: Array<() => Promise<void>> = [];
  const maxConcurrentSends = 3;

  for (const [index, senderTarget] of input.senderTargets.entries()) {
    if (!senderTarget.isAvailable) {
      const unavailableStatus =
        senderTarget.errorMessage === "no_active_sender_bot"
          ? "no_active_sender_bot"
          : "failed";
      senderResultsByIndex.set(index, {
        senderBotId: senderTarget.senderBotId,
        senderBotName: senderTarget.senderBotName,
        status: unavailableStatus,
        errorMessage: senderTarget.errorMessage,
        action: senderTarget.senderBotId
          ? `Failed to send Zoom chat from ${senderTarget.senderBotName ?? senderTarget.senderBotId}: ${input.replyMessage}`
          : `Failed to send Zoom chat: ${input.replyMessage}`,
      });
      continue;
    }

    const executionSenderKey = `${input.triggerExecutionId}:${senderTarget.senderBotId}`;

    if (sentExecutionKeys.has(executionSenderKey)) {
      senderResultsByIndex.set(index, {
        senderBotId: senderTarget.senderBotId,
        senderBotName: senderTarget.senderBotName,
        status: "skipped_duplicate_sender_execution",
        errorMessage: null,
        action: `Skipped duplicate sender execution for ${senderTarget.senderBotName ?? senderTarget.senderBotId}`,
      });
      continue;
    }

    sentExecutionKeys.add(executionSenderKey);
    sendAttemptCount += 1;
    sendTasks.push(async () => {
      if (!input.sendChatEnabled) {
        senderResultsByIndex.set(index, {
          senderBotId: senderTarget.senderBotId,
          senderBotName: senderTarget.senderBotName,
          status: "dry_run",
          errorMessage: null,
          action: `Would send Zoom chat from ${senderTarget.senderBotName ?? senderTarget.senderBotId}: ${input.replyMessage}`,
        });
        return;
      }

      try {
        await sendRecallChatMessage(
          senderTarget.senderBotId as string,
          input.replyMessage,
        );
        senderResultsByIndex.set(index, {
          senderBotId: senderTarget.senderBotId,
          senderBotName: senderTarget.senderBotName,
          status: "sent",
          errorMessage: null,
          action: `Sent Zoom chat from ${senderTarget.senderBotName ?? senderTarget.senderBotId}: ${input.replyMessage}`,
        });
        actualSendCount += 1;
      } catch (error) {
        senderResultsByIndex.set(index, {
          senderBotId: senderTarget.senderBotId,
          senderBotName: senderTarget.senderBotName,
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "Unknown Recall API error.",
          action: `Failed to send Zoom chat from ${senderTarget.senderBotName ?? senderTarget.senderBotId}: ${input.replyMessage}`,
        });
      }
    });
  }

  for (let taskIndex = 0; taskIndex < sendTasks.length; taskIndex += maxConcurrentSends) {
    await Promise.all(
      sendTasks
        .slice(taskIndex, taskIndex + maxConcurrentSends)
        .map((task) => task()),
    );
  }

  return {
    senderResults: input.senderTargets.map(
      (_, index) =>
        senderResultsByIndex.get(index) ?? {
          senderBotId: input.senderTargets[index]?.senderBotId ?? null,
          senderBotName: input.senderTargets[index]?.senderBotName ?? null,
          status: "failed",
          errorMessage: "Sender execution did not complete.",
          action: `Failed to send Zoom chat: ${input.replyMessage}`,
        },
    ),
    sendAttemptCount,
    actualSendCount,
  };
}

function isListenerRecallBot(record: RecallBotRecord | null | undefined): boolean {
  return normalizeRecallBotRole(record?.role, {
    createRequestPayload: record?.createRequestPayload,
    rawRecallResponse: record?.rawRecallResponse,
  }) === "listener";
}

function buildTranscriptLog(input: {
  sessionId: string;
  botId: string | null;
  transcriptText: string;
  normalizedTranscriptText: string;
  matchedRuleIds: string[];
  sourceEvent: TranscriptLog["sourceEvent"];
  createdAt: string;
}): TranscriptLog {
  return {
    id: randomUUID(),
    sessionId: input.sessionId,
    botId: input.botId,
    transcriptText: input.transcriptText,
    normalizedTranscriptText: input.normalizedTranscriptText,
    matchedRuleIds: input.matchedRuleIds,
    sourceEvent: input.sourceEvent,
    createdAt: input.createdAt,
  };
}

function mapMatchLogToSupabaseRow(log: MatchLog) {
  return {
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
  };
}

async function appendMatchedTriggerLog(log: MatchLog): Promise<void> {
  if (getStorageDriver() === "supabase") {
    const client = createSupabaseServiceRoleClient();
    const { error } = await client
      .from("matched_trigger_logs")
      .insert(mapMatchLogToSupabaseRow(log));

    if (error) {
      throw new Error(error.message);
    }

    return;
  }

  await mutateStore(async (store) => {
    store.matchLogs.unshift(log);
    if (store.matchLogs.length > 100) {
      store.matchLogs = store.matchLogs.slice(0, 100);
    }
  });
}

async function appendTranscriptLog(log: TranscriptLog): Promise<void> {
  if (getStorageDriver() === "supabase") {
    const client = createSupabaseServiceRoleClient();
    const { error } = await client.from("transcript_logs").insert({
      id: log.id,
      session_id: log.sessionId,
      bot_id: log.botId,
      transcript_text: log.transcriptText,
      normalized_transcript_text: log.normalizedTranscriptText,
      matched_rule_ids: log.matchedRuleIds,
      source_event: log.sourceEvent,
      created_at: log.createdAt,
    });

    if (error) {
      throw new Error(error.message);
    }

    return;
  }

  await mutateStore(async (store) => {
    store.transcriptLogs.unshift(log);
    if (store.transcriptLogs.length > 100) {
      store.transcriptLogs = store.transcriptLogs.slice(0, 100);
    }
  });
}

async function updateTriggerRuleStats(rule: TriggerRule): Promise<void> {
  if (getStorageDriver() === "supabase") {
    const client = createSupabaseServiceRoleClient();
    const { error } = await client
      .from("trigger_rules")
      .update({
        enabled: rule.enabled,
        last_matched_at: rule.lastMatchedAt,
        last_triggered_at: rule.lastTriggeredAt,
        next_sender_index: rule.nextSenderIndex,
        trigger_count: rule.triggerCount,
        max_trigger_count: rule.maxTriggerCount,
      })
      .eq("id", rule.id);

    if (error) {
      throw new Error(error.message);
    }

    return;
  }
}

async function listRecallBotsBySession(sessionId: string): Promise<RecallBotRecord[]> {
  const normalizedSessionId = normalizeSessionIdInput(sessionId);

  if (getStorageDriver() === "supabase") {
    const client = createSupabaseServiceRoleClient();
    const { data, error } = await client
      .from("recall_bots")
      .select("*")
      .eq("session_id", normalizedSessionId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((bot) =>
      migrateRecallBotRecord({
        id: String(bot.id),
        sessionId: String(bot.session_id ?? ""),
        recallBotId: String(bot.recall_bot_id ?? ""),
        meetingUrl: String(bot.meeting_url ?? ""),
        botName: String(bot.bot_name ?? ""),
        role: typeof bot.role === "string" ? bot.role : undefined,
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
            ? (bot.last_stop_attempt as RecallBotRecord["lastStopAttempt"])
            : null,
        createRequestPayload:
          bot.create_request_payload &&
          typeof bot.create_request_payload === "object" &&
          !Array.isArray(bot.create_request_payload)
            ? (bot.create_request_payload as Record<string, unknown>)
            : {},
        rawRecallResponse:
          bot.raw_recall_response &&
          typeof bot.raw_recall_response === "object" &&
          !Array.isArray(bot.raw_recall_response)
            ? (bot.raw_recall_response as Record<string, unknown>)
            : {},
      }),
    );
  }

  const store = await readStore();
  return sortRecallBots(store.recallBots).filter(
    (bot) => bot.sessionId === normalizedSessionId,
  );
}

async function listRecentMatchLogsForTranscript(input: {
  sessionId: string;
  ruleId: string;
  normalizedTranscriptText: string;
  sinceIso: string;
}): Promise<MatchLog[]> {
  if (getStorageDriver() === "supabase") {
    const client = createSupabaseServiceRoleClient();
    const { data, error } = await client
      .from("matched_trigger_logs")
      .select("*")
      .eq("session_id", input.sessionId)
      .eq("rule_id", input.ruleId)
      .eq("normalized_transcript_text", input.normalizedTranscriptText)
      .gte("created_at", input.sinceIso)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((log) =>
      migrateMatchLog({
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
        status:
          String(log.status ?? "dry_run") as MatchLog["status"],
        senderMode: normalizeSenderMode(String(log.sender_mode ?? "round_robin_bots")),
        senderBotIdsUsed: Array.isArray(log.sender_bot_ids_used)
          ? log.sender_bot_ids_used.map((botId: unknown) => String(botId))
          : [],
        originalSenderBotIds: Array.isArray(log.original_sender_bot_ids)
          ? log.original_sender_bot_ids.map((botId: unknown) => String(botId))
          : [],
        dedupedSenderBotIds: Array.isArray(log.deduped_sender_bot_ids)
          ? log.deduped_sender_bot_ids.map((botId: unknown) => String(botId))
          : [],
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
          log.trigger_count_after === null || log.trigger_count_after === undefined
            ? null
            : Number(log.trigger_count_after),
        maxTriggerCount:
          log.max_trigger_count === null || log.max_trigger_count === undefined
            ? null
            : Number(log.max_trigger_count),
        autoDisabledAfterTrigger: Boolean(log.auto_disabled_after_trigger),
        sendAttemptCount: Number(log.send_attempt_count ?? 0),
        actualSendCount: Number(log.actual_send_count ?? 0),
        warningMessages: Array.isArray(log.warning_messages)
          ? log.warning_messages.map((message: unknown) => String(message))
          : [],
        senderResults: Array.isArray(log.sender_results)
          ? log.sender_results.map((result: unknown) => {
              const senderResult =
                result && typeof result === "object"
                  ? (result as Record<string, unknown>)
                  : {};

              return {
                senderBotId:
                  typeof senderResult.senderBotId === "string"
                    ? senderResult.senderBotId
                    : null,
                senderBotName:
                  typeof senderResult.senderBotName === "string"
                    ? senderResult.senderBotName
                    : null,
                status:
                  senderResult.status === "sent" ||
                  senderResult.status === "failed" ||
                  senderResult.status === "no_active_sender_bot" ||
                  senderResult.status === "skipped_dedupe" ||
                  senderResult.status === "skipped_duplicate_sender_execution"
                    ? senderResult.status
                    : "dry_run",
                errorMessage:
                  typeof senderResult.errorMessage === "string"
                    ? senderResult.errorMessage
                    : null,
                action: String(senderResult.action ?? ""),
              };
            })
          : [],
        errorMessage:
          typeof log.error_message === "string" ? log.error_message : null,
        action: String(log.action ?? ""),
      }),
    );
  }

  const store = await readStore();
  return store.matchLogs.filter(
    (log) =>
      log.sessionId === input.sessionId &&
      log.ruleId === input.ruleId &&
      log.normalizedTranscriptText === input.normalizedTranscriptText &&
      log.createdAt >= input.sinceIso,
  );
}

function deriveMatchStatus(senderResults: MatchSenderResult[]): MatchLog["status"] {
  const hasSent = senderResults.some((senderResult) => senderResult.status === "sent");
  const hasDryRun = senderResults.some(
    (senderResult) => senderResult.status === "dry_run",
  );
  const hasNoActiveSenderBot = senderResults.some(
    (senderResult) => senderResult.status === "no_active_sender_bot",
  );
  const firstFailure = senderResults.find(
    (senderResult) => senderResult.status === "failed",
  );
  const hasSkippedDuplicateSenderExecution = senderResults.some(
    (senderResult) =>
      senderResult.status === "skipped_duplicate_sender_execution",
  );

  if (hasSent) {
    return "sent";
  }

  if (hasDryRun) {
    return "dry_run";
  }

  if (hasNoActiveSenderBot) {
    return "no_active_sender_bot";
  }

  if (firstFailure) {
    return "failed";
  }

  if (hasSkippedDuplicateSenderExecution) {
    return "skipped_duplicate_sender_execution";
  }

  return "dry_run";
}

function isSuccessfulAcceptedSenderStatus(status: MatchSenderResult["status"]): boolean {
  return status === "dry_run" || status === "sent";
}

function pushTimerTriggerLog(
  store: StoreData,
  timerTriggerLog: TimerTriggerLog,
): void {
  store.timerTriggerLogs.unshift(timerTriggerLog);

  if (store.timerTriggerLogs.length > 200) {
    store.timerTriggerLogs = store.timerTriggerLogs.slice(0, 200);
  }
}

function pushLiveChatLog(store: StoreData, liveChatLog: LiveChatLog): void {
  store.liveChatLogs.unshift(liveChatLog);

  if (store.liveChatLogs.length > 200) {
    store.liveChatLogs = store.liveChatLogs.slice(0, 200);
  }
}

function getEarliestActiveJoinedAt(recallBots: RecallBotRecord[]): string | null {
  const joinedAtValues = recallBots
    .filter((bot) => isBotActiveStatus(bot.status) && bot.joinedAt)
    .map((bot) => bot.joinedAt as string)
    .sort((left, right) => left.localeCompare(right));

  return joinedAtValues[0] ?? null;
}

export async function findSessionIdForRecallBotId(
  recallBotId: string | null | undefined,
): Promise<string> {
  const recallBot = await getRecallBotByRecallBotId(recallBotId);

  if (recallBot) {
    return recallBot.sessionId;
  }

  const store = await readStore();
  const defaultSession = ensureDefaultSessionExists(store);

  if (!recallBotId) {
    return defaultSession.id;
  }

  return defaultSession.id;
}

export async function processTranscriptWebhook(input: {
  sessionId?: string;
  botId: string | null;
  transcriptText: string;
  sourceEvent: "transcript.data" | "transcript.partial_data";
}): Promise<{
  transcriptLog: TranscriptLog;
  matchedLogs: MatchLog[];
}> {
  if (getStorageDriver() === "supabase") {
    return queueStoreMutation(async () => {
      const sourceBotRecord = await getRecallBotByRecallBotId(input.botId);
      const sessionId =
        sourceBotRecord?.sessionId ??
        normalizeSessionIdInput(input.sessionId ?? DEFAULT_SESSION_ID);
      const transcriptText = input.transcriptText.trim();
      const normalizedTranscriptText = normalizeTranscript(transcriptText);
      const receivedAt = new Date();
      const transcriptLog = buildTranscriptLog({
        sessionId,
        botId: input.botId,
        transcriptText,
        normalizedTranscriptText,
        matchedRuleIds: [],
        sourceEvent: input.sourceEvent,
        createdAt: receivedAt.toISOString(),
      });

      if (sourceBotRecord && !isListenerRecallBot(sourceBotRecord)) {
        if ((await getAppSettings()).storageLoggingMode === "debug") {
          await appendTranscriptLog(transcriptLog);
        }

        return {
          transcriptLog,
          matchedLogs: [],
        };
      }

      const matchedLogs: MatchLog[] = [];
      const sendChatEnabled = isRecallSendChatEnabled();
      const dedupeWindowMs = 5000;
      const sessionRules = await listEnabledTriggerRulesBySession(sessionId);
      const sessionBots = await listRecallBotsBySession(sessionId);

      for (const rule of sessionRules) {
        if (rule.enabled && hasReachedMaxTriggerCount(rule)) {
          rule.enabled = false;
          await updateTriggerRuleStats(rule);
        }
      }

      const matchedRule = sessionRules.find(
        (rule) =>
          rule.enabled &&
          !hasReachedMaxTriggerCount(rule) &&
          normalizedTranscriptText.includes(rule.normalizedTrigger),
      );

      if (matchedRule) {
        const senderTargetBuildResult = buildSenderTargets({
          matchedRule,
          webhookBotId: input.botId,
          recallBots: sessionBots,
        });
        const senderBotIdsUsed = senderTargetBuildResult.senderTargets
          .map((senderTarget) => senderTarget.senderBotId)
          .filter((senderBotId): senderBotId is string => Boolean(senderBotId));
        const acceptedExecutionLockKey = `${matchedRule.id}:${normalizedTranscriptText}`;
        const recentDuplicate = (
          await listRecentMatchLogsForTranscript({
            sessionId,
            ruleId: matchedRule.id,
            normalizedTranscriptText,
            sinceIso: new Date(receivedAt.getTime() - dedupeWindowMs).toISOString(),
          })
        ).find((log) => {
          if (log.ruleId !== matchedRule.id) {
            return false;
          }

          if (log.normalizedTranscriptText !== normalizedTranscriptText) {
            return false;
          }

          return (
            receivedAt.getTime() - new Date(log.createdAt).getTime() < dedupeWindowMs
          );
        });
        const activeExecutionLock = activeTriggerExecutionLocks.get(
          acceptedExecutionLockKey,
        );

        if (recentDuplicate || activeExecutionLock) {
          const senderResults: MatchSenderResult[] =
            senderTargetBuildResult.senderTargets.map((senderTarget) => ({
              senderBotId: senderTarget.senderBotId,
              senderBotName: senderTarget.senderBotName,
              status: "skipped_dedupe",
              errorMessage: null,
              action: senderTarget.senderBotId
                ? activeExecutionLock
                  ? `Skipped duplicate send for ${senderTarget.senderBotName ?? senderTarget.senderBotId} because another accepted execution is already in progress.`
                  : `Skipped duplicate send for ${senderTarget.senderBotName ?? senderTarget.senderBotId}`
                : activeExecutionLock
                  ? "Skipped duplicate send because another accepted execution is already in progress for this rule and transcript."
                  : "Skipped duplicate send because the same rule and transcript already fired recently.",
            }));
          const createdAt = new Date().toISOString();
          const warningMessages = [...senderTargetBuildResult.warningMessages];

          if (activeExecutionLock) {
            warningMessages.push(
              `Active accepted execution lock prevented a duplicate send for ${acceptedExecutionLockKey}.`,
            );
          }

          const matchedLog: MatchLog = {
            id: randomUUID(),
            sessionId,
            botId: input.botId,
            triggerExecutionId: activeExecutionLock?.executionId ?? null,
            sourceEvent: input.sourceEvent,
            sourceWebhookBotId: input.botId,
            ruleId: matchedRule.id,
            triggerPhrase: matchedRule.triggerPhrase,
            replyMessage: matchedRule.replyMessage,
            transcriptText,
            normalizedTranscriptText,
            createdAt,
            status: "skipped_dedupe",
            senderMode: matchedRule.senderMode,
            senderBotIdsUsed,
            originalSenderBotIds: senderTargetBuildResult.originalSenderBotIds,
            dedupedSenderBotIds: senderTargetBuildResult.dedupedSenderBotIds,
            chosenRoundRobinBotId: senderTargetBuildResult.chosenRoundRobinBotId,
            chosenRoundRobinBotName: senderTargetBuildResult.chosenRoundRobinBotName,
            previousRoundRobinIndex:
              senderTargetBuildResult.previousRoundRobinIndex,
            nextRoundRobinIndex: senderTargetBuildResult.nextRoundRobinIndex,
            responseDelaySeconds: matchedRule.responseDelaySeconds,
            triggerCountAfter: matchedRule.triggerCount,
            maxTriggerCount: matchedRule.maxTriggerCount,
            autoDisabledAfterTrigger: false,
            sendAttemptCount: 0,
            actualSendCount: 0,
            warningMessages,
            senderResults,
            errorMessage: null,
            action: activeExecutionLock
              ? `Skipped duplicate send for rule "${matchedRule.triggerPhrase}" because an accepted execution is already in progress.`
              : `Skipped duplicate send for rule "${matchedRule.triggerPhrase}".`,
          };

          matchedLogs.push(matchedLog);
          await appendMatchedTriggerLog(matchedLog);
        } else {
          const previousMatchTime = matchedRule.lastMatchedAt
            ? new Date(matchedRule.lastMatchedAt).getTime()
            : null;
          const cooldownMs = matchedRule.cooldownSeconds * 1000;
          const cooldownReady =
            previousMatchTime === null ||
            cooldownMs === 0 ||
            receivedAt.getTime() - previousMatchTime >= cooldownMs;

          if (cooldownReady) {
            const triggerExecutionId = randomUUID();
            const acceptedAtIso = receivedAt.toISOString();
            activeTriggerExecutionLocks.set(acceptedExecutionLockKey, {
              executionId: triggerExecutionId,
              acceptedAt: receivedAt.getTime(),
            });
            matchedRule.lastMatchedAt = acceptedAtIso;
            await updateTriggerRuleStats(matchedRule);

            try {
              // Local MVP waits inline before sending and logging. In production,
              // delayed sends should move to a background job or queue.
              await delay(matchedRule.responseDelaySeconds * 1000);

              const createdAt = new Date().toISOString();
              matchedRule.lastTriggeredAt = createdAt;
              matchedRule.triggerCount += 1;

              const executionResult = await executeSenderTargets({
                triggerExecutionId,
                senderTargets: senderTargetBuildResult.senderTargets,
                replyMessage: matchedRule.replyMessage,
                sendChatEnabled,
              });
              const firstFailure = executionResult.senderResults.find(
                (senderResult) => senderResult.status === "failed",
              );
              const status = deriveMatchStatus(executionResult.senderResults);
              const autoDisabledAfterTrigger =
                hasReachedMaxTriggerCount(matchedRule) && matchedRule.enabled;

              if (autoDisabledAfterTrigger) {
                matchedRule.enabled = false;
              }

              if (
                matchedRule.senderMode === "round_robin_bots" &&
                senderTargetBuildResult.chosenRoundRobinBotId
              ) {
                matchedRule.nextSenderIndex =
                  senderTargetBuildResult.nextRoundRobinIndex ??
                  matchedRule.nextSenderIndex;
              }

              await updateTriggerRuleStats(matchedRule);

              const matchedLog: MatchLog = {
                id: randomUUID(),
                sessionId,
                botId: input.botId,
                triggerExecutionId,
                sourceEvent: input.sourceEvent,
                sourceWebhookBotId: input.botId,
                ruleId: matchedRule.id,
                triggerPhrase: matchedRule.triggerPhrase,
                replyMessage: matchedRule.replyMessage,
                transcriptText,
                normalizedTranscriptText,
                createdAt,
                status,
                senderMode: matchedRule.senderMode,
                senderBotIdsUsed,
                originalSenderBotIds: senderTargetBuildResult.originalSenderBotIds,
                dedupedSenderBotIds: senderTargetBuildResult.dedupedSenderBotIds,
                chosenRoundRobinBotId:
                  senderTargetBuildResult.chosenRoundRobinBotId,
                chosenRoundRobinBotName:
                  senderTargetBuildResult.chosenRoundRobinBotName,
                previousRoundRobinIndex:
                  senderTargetBuildResult.previousRoundRobinIndex,
                nextRoundRobinIndex:
                  matchedRule.senderMode === "round_robin_bots"
                    ? matchedRule.nextSenderIndex
                    : senderTargetBuildResult.nextRoundRobinIndex,
                responseDelaySeconds: matchedRule.responseDelaySeconds,
                triggerCountAfter: matchedRule.triggerCount,
                maxTriggerCount: matchedRule.maxTriggerCount,
                autoDisabledAfterTrigger,
                sendAttemptCount: executionResult.sendAttemptCount,
                actualSendCount: executionResult.actualSendCount,
                warningMessages: senderTargetBuildResult.warningMessages,
                senderResults: executionResult.senderResults,
                errorMessage: firstFailure?.errorMessage ?? null,
                action: executionResult.senderResults
                  .map((senderResult) => senderResult.action)
                  .join(" | "),
              };

              matchedLogs.push(matchedLog);
              await appendMatchedTriggerLog(matchedLog);
            } finally {
              activeTriggerExecutionLocks.delete(acceptedExecutionLockKey);
            }
          }
        }
      }

      const finalTranscriptLog = {
        ...transcriptLog,
        matchedRuleIds: matchedLogs.map((log) => log.ruleId),
      };

      if ((await getAppSettings()).storageLoggingMode === "debug") {
        await appendTranscriptLog(finalTranscriptLog);
      }

      return {
        transcriptLog: finalTranscriptLog,
        matchedLogs,
      };
    });
  }

  return mutateStore(async (store) => {
    const sourceBotRecord =
      store.recallBots.find((bot) => bot.recallBotId === input.botId) ?? null;
    const sessionId =
      findMeetingSessionById(store, input.sessionId ?? null)?.id ??
      sourceBotRecord?.sessionId ??
      ensureDefaultSessionExists(store).id;
    const transcriptText = input.transcriptText.trim();
    const normalizedTranscriptText = normalizeTranscript(transcriptText);
    const receivedAt = new Date();
    const matchedLogs: MatchLog[] = [];
    const sendChatEnabled = isRecallSendChatEnabled();
    const dedupeWindowMs = 5000;
    const sessionRules = store.triggerRules.filter((rule) => rule.sessionId === sessionId);
    const sessionBots = store.recallBots.filter((bot) => bot.sessionId === sessionId);
    const sessionMatchLogs = store.matchLogs.filter((log) => log.sessionId === sessionId);

    if (!sourceBotRecord || isListenerRecallBot(sourceBotRecord)) {
      for (const rule of sessionRules) {
        if (rule.enabled && hasReachedMaxTriggerCount(rule)) {
          rule.enabled = false;
        }
      }
      // Only the first enabled matching rule is allowed to fire so one
      // transcript event cannot generate duplicate Zoom chat messages.
      const matchedRule = sessionRules.find(
        (rule) =>
          rule.enabled &&
          !hasReachedMaxTriggerCount(rule) &&
          normalizedTranscriptText.includes(rule.normalizedTrigger),
      );

      if (matchedRule) {
        const senderTargetBuildResult = buildSenderTargets({
          matchedRule,
          webhookBotId: input.botId,
          recallBots: sessionBots,
        });
        const senderBotIdsUsed = senderTargetBuildResult.senderTargets
          .map((senderTarget) => senderTarget.senderBotId)
          .filter((senderBotId): senderBotId is string => Boolean(senderBotId));
        const acceptedExecutionLockKey = `${matchedRule.id}:${normalizedTranscriptText}`;
        const recentDuplicate = sessionMatchLogs.find((log) => {
          if (log.ruleId !== matchedRule.id) {
            return false;
          }

          if (log.normalizedTranscriptText !== normalizedTranscriptText) {
            return false;
          }

          return (
            receivedAt.getTime() - new Date(log.createdAt).getTime() < dedupeWindowMs
          );
        });
        const activeExecutionLock = activeTriggerExecutionLocks.get(
          acceptedExecutionLockKey,
        );

        if (recentDuplicate || activeExecutionLock) {
          const senderResults: MatchSenderResult[] =
            senderTargetBuildResult.senderTargets.map((senderTarget) => ({
              senderBotId: senderTarget.senderBotId,
              senderBotName: senderTarget.senderBotName,
              status: "skipped_dedupe",
              errorMessage: null,
              action: senderTarget.senderBotId
                ? activeExecutionLock
                  ? `Skipped duplicate send for ${senderTarget.senderBotName ?? senderTarget.senderBotId} because another accepted execution is already in progress.`
                  : `Skipped duplicate send for ${senderTarget.senderBotName ?? senderTarget.senderBotId}`
                : activeExecutionLock
                  ? "Skipped duplicate send because another accepted execution is already in progress for this rule and transcript."
                  : "Skipped duplicate send because the same rule and transcript already fired recently.",
            }));
          const createdAt = new Date().toISOString();
          const warningMessages = [...senderTargetBuildResult.warningMessages];

          if (activeExecutionLock) {
            warningMessages.push(
              `Active accepted execution lock prevented a duplicate send for ${acceptedExecutionLockKey}.`,
            );
          }

          matchedLogs.push({
            id: randomUUID(),
            sessionId,
            botId: input.botId,
            triggerExecutionId: activeExecutionLock?.executionId ?? null,
            sourceEvent: input.sourceEvent,
            sourceWebhookBotId: input.botId,
            ruleId: matchedRule.id,
            triggerPhrase: matchedRule.triggerPhrase,
            replyMessage: matchedRule.replyMessage,
            transcriptText,
            normalizedTranscriptText,
            createdAt,
            status: "skipped_dedupe",
            senderMode: matchedRule.senderMode,
            senderBotIdsUsed,
            originalSenderBotIds: senderTargetBuildResult.originalSenderBotIds,
            dedupedSenderBotIds: senderTargetBuildResult.dedupedSenderBotIds,
            chosenRoundRobinBotId: senderTargetBuildResult.chosenRoundRobinBotId,
            chosenRoundRobinBotName: senderTargetBuildResult.chosenRoundRobinBotName,
            previousRoundRobinIndex: senderTargetBuildResult.previousRoundRobinIndex,
            nextRoundRobinIndex: senderTargetBuildResult.nextRoundRobinIndex,
            responseDelaySeconds: matchedRule.responseDelaySeconds,
            triggerCountAfter: matchedRule.triggerCount,
            maxTriggerCount: matchedRule.maxTriggerCount,
            autoDisabledAfterTrigger: false,
            sendAttemptCount: 0,
            actualSendCount: 0,
            warningMessages,
            senderResults,
            errorMessage: null,
            action: activeExecutionLock
              ? `Skipped duplicate send for rule "${matchedRule.triggerPhrase}" because an accepted execution is already in progress.`
              : `Skipped duplicate send for rule "${matchedRule.triggerPhrase}".`,
          });
        } else {
          const previousMatchTime = matchedRule.lastMatchedAt
            ? new Date(matchedRule.lastMatchedAt).getTime()
            : null;
          const cooldownMs = matchedRule.cooldownSeconds * 1000;
          const cooldownReady =
            previousMatchTime === null ||
            cooldownMs === 0 ||
            receivedAt.getTime() - previousMatchTime >= cooldownMs;

          if (cooldownReady) {
            const triggerExecutionId = randomUUID();
            const acceptedAtIso = receivedAt.toISOString();
            activeTriggerExecutionLocks.set(acceptedExecutionLockKey, {
              executionId: triggerExecutionId,
              acceptedAt: receivedAt.getTime(),
            });
            matchedRule.lastMatchedAt = acceptedAtIso;

            try {
              // Local MVP waits inline before sending and logging. In production,
              // delayed sends should move to a background job or queue.
              await delay(matchedRule.responseDelaySeconds * 1000);

              const createdAt = new Date().toISOString();
              matchedRule.lastTriggeredAt = createdAt;
              matchedRule.triggerCount += 1;

              const executionResult = await executeSenderTargets({
                triggerExecutionId,
                senderTargets: senderTargetBuildResult.senderTargets,
                replyMessage: matchedRule.replyMessage,
                sendChatEnabled,
              });
              const firstFailure = executionResult.senderResults.find(
                (senderResult) => senderResult.status === "failed",
              );
              const status = deriveMatchStatus(executionResult.senderResults);
              const autoDisabledAfterTrigger =
                hasReachedMaxTriggerCount(matchedRule) && matchedRule.enabled;

              if (autoDisabledAfterTrigger) {
                matchedRule.enabled = false;
              }

              if (
                matchedRule.senderMode === "round_robin_bots" &&
                senderTargetBuildResult.chosenRoundRobinBotId
              ) {
                matchedRule.nextSenderIndex =
                  senderTargetBuildResult.nextRoundRobinIndex ??
                  matchedRule.nextSenderIndex;
              }

              matchedLogs.push({
                id: randomUUID(),
                sessionId,
                botId: input.botId,
                triggerExecutionId,
                sourceEvent: input.sourceEvent,
                sourceWebhookBotId: input.botId,
                ruleId: matchedRule.id,
                triggerPhrase: matchedRule.triggerPhrase,
                replyMessage: matchedRule.replyMessage,
                transcriptText,
                normalizedTranscriptText,
                createdAt,
                status,
                senderMode: matchedRule.senderMode,
                senderBotIdsUsed,
                originalSenderBotIds: senderTargetBuildResult.originalSenderBotIds,
                dedupedSenderBotIds: senderTargetBuildResult.dedupedSenderBotIds,
                chosenRoundRobinBotId: senderTargetBuildResult.chosenRoundRobinBotId,
                chosenRoundRobinBotName:
                  senderTargetBuildResult.chosenRoundRobinBotName,
                previousRoundRobinIndex:
                  senderTargetBuildResult.previousRoundRobinIndex,
                nextRoundRobinIndex:
                  matchedRule.senderMode === "round_robin_bots"
                    ? matchedRule.nextSenderIndex
                    : senderTargetBuildResult.nextRoundRobinIndex,
                responseDelaySeconds: matchedRule.responseDelaySeconds,
                triggerCountAfter: matchedRule.triggerCount,
                maxTriggerCount: matchedRule.maxTriggerCount,
                autoDisabledAfterTrigger,
                sendAttemptCount: executionResult.sendAttemptCount,
                actualSendCount: executionResult.actualSendCount,
                warningMessages: senderTargetBuildResult.warningMessages,
                senderResults: executionResult.senderResults,
                errorMessage: firstFailure?.errorMessage ?? null,
                action: executionResult.senderResults
                  .map((senderResult) => senderResult.action)
                  .join(" | "),
              });
            } finally {
              activeTriggerExecutionLocks.delete(acceptedExecutionLockKey);
            }
          }
        }
      }
    }

    const transcriptLog = buildTranscriptLog({
      sessionId,
      botId: input.botId,
      transcriptText,
      normalizedTranscriptText,
      matchedRuleIds: matchedLogs.map((log) => log.ruleId),
      sourceEvent: input.sourceEvent,
      createdAt: receivedAt.toISOString(),
    });

    if (shouldPersistTranscriptLog(store)) {
      store.transcriptLogs.unshift(transcriptLog);
      if (store.transcriptLogs.length > 100) {
        store.transcriptLogs = store.transcriptLogs.slice(0, 100);
      }
    }

    if (matchedLogs.length > 0) {
      store.matchLogs.unshift(...matchedLogs);
    }
    if (store.matchLogs.length > 100) {
      store.matchLogs = store.matchLogs.slice(0, 100);
    }

    return {
      transcriptLog,
      matchedLogs,
    };
  });
}

export async function runDueTimerTriggers(input?: {
  sessionId?: string;
}): Promise<{
  meetingSessionId: string;
  meetingJoinedAt: string | null;
  executedCount: number;
  skippedCount: number;
  timerTriggerLogs: TimerTriggerLog[];
}> {
  return mutateStore(async (store) => {
    const session =
      findMeetingSessionById(store, input?.sessionId ?? null) ??
      ensureDefaultSessionExists(store);
    const sessionId = session.id;
    const sessionBlockedMessage = getSessionOperationBlockedMessage(session.status);

    if (sessionBlockedMessage) {
      return {
        meetingSessionId: sessionId,
        meetingJoinedAt: null,
        executedCount: 0,
        skippedCount: 0,
        timerTriggerLogs: [],
      };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const sendChatEnabled = isRecallSendChatEnabled();
    const sessionBots = store.recallBots.filter((bot) => bot.sessionId === sessionId);
    const sessionTimerTriggers = sortTimerTriggers(store.timerTriggers).filter(
      (trigger) => trigger.sessionId === sessionId,
    );
    const meetingJoinedAt = getEarliestActiveJoinedAt(sessionBots);
    const timerTriggerLogs: TimerTriggerLog[] = [];
    let executedCount = 0;
    let skippedCount = 0;

    for (const timerTrigger of sessionTimerTriggers) {
      if (!timerTrigger.enabled) {
        continue;
      }

      if (
        timerTrigger.senderMode === "specific_bots" &&
        timerTrigger.senderBotIds.length === 0
      ) {
        skippedCount += 1;
        continue;
      }

      const scheduledFor = meetingJoinedAt
        ? new Date(
            new Date(meetingJoinedAt).getTime() +
              timerTrigger.delayMinutesAfterJoin * 60 * 1000,
          ).toISOString()
        : nowIso;

      if (hasReachedMaxTriggerCount(timerTrigger)) {
        const timerTriggerLog: TimerTriggerLog = {
          id: randomUUID(),
          sessionId,
          timerTriggerId: timerTrigger.id,
          timerTriggerName: timerTrigger.name,
          scheduledFor,
          executedAt: nowIso,
          message: timerTrigger.message,
          senderMode: timerTrigger.senderMode,
          senderBotIdUsed: null,
          senderBotIdsUsed: [],
          status: "skipped_limit_reached",
          errorMessage: "Max trigger count has been reached.",
        };

        if (shouldPersistSkippedTimerTriggerLog(store)) {
          pushTimerTriggerLog(store, timerTriggerLog);
          timerTriggerLogs.push(timerTriggerLog);
        }
        skippedCount += 1;
        continue;
      }

      if (!meetingJoinedAt || now.getTime() < new Date(scheduledFor).getTime()) {
        const timerTriggerLog: TimerTriggerLog = {
          id: randomUUID(),
          sessionId,
          timerTriggerId: timerTrigger.id,
          timerTriggerName: timerTrigger.name,
          scheduledFor,
          executedAt: nowIso,
          message: timerTrigger.message,
          senderMode: timerTrigger.senderMode,
          senderBotIdUsed: null,
          senderBotIdsUsed: [],
          status: "skipped_not_due",
          errorMessage: meetingJoinedAt
            ? "Timer trigger is not due yet."
            : "No active bot joinedAt is available yet.",
        };

        if (shouldPersistSkippedTimerTriggerLog(store)) {
          pushTimerTriggerLog(store, timerTriggerLog);
          timerTriggerLogs.push(timerTriggerLog);
        }
        skippedCount += 1;
        continue;
      }

      if (timerTrigger.responseDelaySeconds > 0) {
        // Local MVP waits inline. Production timers should move to cron/background jobs.
        await delay(timerTrigger.responseDelaySeconds * 1000);
      }

      const senderTargetBuildResult = buildTimerTriggerSenderTargets({
        timerTrigger,
        recallBots: sessionBots,
      });
      const executionResult = await executeSenderTargets({
        triggerExecutionId: randomUUID(),
        senderTargets: senderTargetBuildResult.senderTargets,
        replyMessage: timerTrigger.message,
        sendChatEnabled,
      });
      const firstFailure = executionResult.senderResults.find(
        (senderResult) => senderResult.status === "failed",
      );
      const status = deriveMatchStatus(executionResult.senderResults);
      const hasAvailableSender = senderTargetBuildResult.senderTargets.some(
        (senderTarget) => senderTarget.isAvailable,
      );

      timerTrigger.triggerCount += 1;
      timerTrigger.lastTriggeredAt = new Date().toISOString();
      timerTrigger.updatedAt = timerTrigger.lastTriggeredAt;
      if (
        timerTrigger.senderMode === "round_robin_bots" &&
        hasAvailableSender
      ) {
        timerTrigger.nextSenderIndex = normalizeNonNegativeInteger(
          timerTrigger.nextSenderIndex + 1,
        );
      }

      const timerTriggerLog: TimerTriggerLog = {
        id: randomUUID(),
        sessionId,
        timerTriggerId: timerTrigger.id,
        timerTriggerName: timerTrigger.name,
        scheduledFor,
        executedAt: timerTrigger.lastTriggeredAt,
        message: timerTrigger.message,
        senderMode: timerTrigger.senderMode,
        senderBotIdUsed: senderTargetBuildResult.senderBotIdUsed,
        senderBotIdsUsed: senderTargetBuildResult.senderBotIdsUsed,
        status:
          status === "sent" ||
          status === "dry_run" ||
          status === "failed" ||
          status === "no_active_sender_bot"
            ? status
            : "failed",
        errorMessage: firstFailure?.errorMessage ?? null,
      };

      pushTimerTriggerLog(store, timerTriggerLog);
      timerTriggerLogs.push(timerTriggerLog);
      executedCount += 1;
    }

    return {
      meetingSessionId: sessionId,
      meetingJoinedAt,
      executedCount,
      skippedCount,
      timerTriggerLogs,
    };
  });
}

export async function runDueScheduledBotJoins(): Promise<{
  checkedAt: string;
  processedCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  scheduledBotJoins: ScheduledBotJoin[];
}> {
  return mutateStore(async (store) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const preflight = getRecallPreflight();
    const dueSchedules = sortScheduledBotJoins(store.scheduledBotJoins).filter(
      (scheduledBotJoin) =>
        scheduledBotJoin.enabled &&
        scheduledBotJoin.status === "pending" &&
        new Date(scheduledBotJoin.scheduledAt).getTime() <= now.getTime(),
    );
    const skippedCount = sortScheduledBotJoins(store.scheduledBotJoins).filter(
      (scheduledBotJoin) =>
        scheduledBotJoin.enabled &&
        scheduledBotJoin.status === "pending" &&
        new Date(scheduledBotJoin.scheduledAt).getTime() > now.getTime(),
    ).length;
    const completedSchedules: ScheduledBotJoin[] = [];
    let completedCount = 0;
    let failedCount = 0;

    for (const scheduledBotJoin of dueSchedules) {
      scheduledBotJoin.status = "running";
      scheduledBotJoin.errorMessage = null;
      scheduledBotJoin.lastRunAt = nowIso;
      scheduledBotJoin.updatedAt = nowIso;

      const session =
        findMeetingSessionById(store, scheduledBotJoin.sessionId) ??
        ensureDefaultSessionExists(store);
      const sessionBlockedMessage = getSessionOperationBlockedMessage(session.status);
      const meetingUrl = session.zoomUrl.trim();

      if (sessionBlockedMessage) {
        scheduledBotJoin.status =
          session.status === "ended" || session.status === "archived"
            ? "cancelled"
            : "failed";
        scheduledBotJoin.enabled = false;
        scheduledBotJoin.errorMessage = sessionBlockedMessage;
        scheduledBotJoin.updatedAt = new Date().toISOString();
        scheduledBotJoin.createdBotIds = [];
        failedCount += 1;
        completedSchedules.push({ ...scheduledBotJoin });
        continue;
      }

      if (!meetingUrl) {
        scheduledBotJoin.status = "failed";
        scheduledBotJoin.errorMessage =
          "Selected session has no Zoom URL. Please add Zoom URL before scheduling bots.";
        scheduledBotJoin.updatedAt = new Date().toISOString();
        scheduledBotJoin.createdBotIds = [];
        failedCount += 1;
        completedSchedules.push({ ...scheduledBotJoin });
        continue;
      }

      if (preflight.errors.length > 0) {
        scheduledBotJoin.status = "failed";
        scheduledBotJoin.errorMessage = preflight.errors.join(" ");
        scheduledBotJoin.updatedAt = new Date().toISOString();
        scheduledBotJoin.createdBotIds = [];
        failedCount += 1;
        completedSchedules.push({ ...scheduledBotJoin });
        continue;
      }

      const createdBotIds: string[] = [];
      const errors: string[] = [];

      for (let index = 0; index < scheduledBotJoin.botNames.length; index += 1) {
        const botName = scheduledBotJoin.botNames[index];
        const role = getBotRoleForCreationIndex(index);

        try {
          const createRequestPayload = buildCreateRecallBotPayload({
            meetingUrl,
            botName,
            transcriptLanguage: scheduledBotJoin.transcriptLanguage,
            role,
          });
          const rawRecallResponse = await createRecallBot({
            meetingUrl,
            botName,
            transcriptLanguage: scheduledBotJoin.transcriptLanguage,
            role,
          });
          const recallBotRecord = appendRecallBotRecordToStore(store, {
            sessionId: scheduledBotJoin.sessionId,
            meetingUrl,
            botName,
            role,
            transcriptLanguage: scheduledBotJoin.transcriptLanguage,
            createRequestPayload,
            rawRecallResponse,
          });

          createdBotIds.push(recallBotRecord.recallBotId);
        } catch (error) {
          errors.push(
            `Bot ${index + 1} (${botName}): ${
              error instanceof Error
                ? error.message
                : "Failed to create Recall bot."
            }`,
          );
        }
      }

      scheduledBotJoin.createdBotIds = createdBotIds;
      scheduledBotJoin.lastRunAt = new Date().toISOString();
      scheduledBotJoin.updatedAt = scheduledBotJoin.lastRunAt;

      if (errors.length > 0) {
        scheduledBotJoin.status = "failed";
        scheduledBotJoin.errorMessage = errors.join(" | ");
        failedCount += 1;
      } else {
        scheduledBotJoin.status = "completed";
        scheduledBotJoin.errorMessage = null;
        completedCount += 1;
      }

      completedSchedules.push({ ...scheduledBotJoin });
    }

    return {
      checkedAt: nowIso,
      processedCount: dueSchedules.length,
      completedCount,
      failedCount,
      skippedCount,
      scheduledBotJoins: completedSchedules,
    };
  });
}

export async function sendLiveChat(input: {
  sessionId: string;
  message: string;
  senderMode: SenderMode;
  senderBotIds: string[];
}): Promise<LiveChatLog> {
  return mutateStore(async (store) => {
    const session =
      findMeetingSessionById(store, input.sessionId) ??
      ensureDefaultSessionExists(store);
    const sessionId = session.id;
    const sessionBlockedMessage = getSessionOperationBlockedMessage(session.status);
    const message = input.message.trim();

    if (!message) {
      throw new Error("Message is required.");
    }

    if (sessionBlockedMessage) {
      throw new Error(sessionBlockedMessage);
    }

    if (input.senderMode === "specific_bots" && input.senderBotIds.length === 0) {
      throw new Error(
        "Select at least one active bot before sending in specific bot mode.",
      );
    }

    const senderTargetBuildResult = buildLiveChatSenderTargets({
      senderMode: input.senderMode,
      senderBotIds: input.senderBotIds,
      recallBots: store.recallBots.filter((bot) => bot.sessionId === sessionId),
      roundRobinIndex: store.liveChatRoundRobinIndex,
    });
    const executionResult = await executeSenderTargets({
      triggerExecutionId: randomUUID(),
      senderTargets: senderTargetBuildResult.senderTargets,
      replyMessage: message,
      sendChatEnabled: isRecallSendChatEnabled(),
    });
    const firstFailure = executionResult.senderResults.find(
      (senderResult) => senderResult.status === "failed",
    );
    const status = deriveMatchStatus(executionResult.senderResults);
    const hasSuccessfulAcceptedSend = executionResult.senderResults.some(
      (senderResult) => isSuccessfulAcceptedSenderStatus(senderResult.status),
    );

    if (
      input.senderMode === "round_robin_bots" &&
      senderTargetBuildResult.chosenRoundRobinBotId &&
      hasSuccessfulAcceptedSend
    ) {
      store.liveChatRoundRobinIndex =
        senderTargetBuildResult.nextRoundRobinIndex;
    }

    const liveChatLog: LiveChatLog = {
      id: randomUUID(),
      sessionId,
      message,
      senderMode: input.senderMode,
      senderBotIdsUsed: senderTargetBuildResult.senderBotIdsUsed,
      senderResults: executionResult.senderResults,
      status,
      createdAt: new Date().toISOString(),
      errorMessage: firstFailure?.errorMessage ?? null,
    };

    pushLiveChatLog(store, liveChatLog);

    return liveChatLog;
  });
}

export async function saveWebhookDebugLog(input: {
  sessionId: string;
  eventName: string;
  rawPayload: unknown;
  receivedAt: string;
  botId: string | null;
  status: WebhookDebugLog["status"];
  extractedTranscriptText: string | null;
  errorMessage: string | null;
}): Promise<WebhookDebugLog> {
  return mutateStore(async (store) => {
    const sessionId =
      findMeetingSessionById(store, input.sessionId)?.id ??
      ensureDefaultSessionExists(store).id;
    const debugLog: WebhookDebugLog = {
      id: randomUUID(),
      sessionId,
      eventName: input.eventName,
      rawPayload: isDebugStorageLoggingMode(store) ? input.rawPayload : null,
      receivedAt: input.receivedAt,
      botId: input.botId,
      status: input.status,
      extractedTranscriptText: input.extractedTranscriptText,
      errorMessage: input.errorMessage,
    };

    if (shouldPersistWebhookDebugLog(store, input.status)) {
      store.webhookDebugLogs.unshift(debugLog);
      if (store.webhookDebugLogs.length > 200) {
        store.webhookDebugLogs = store.webhookDebugLogs.slice(0, 200);
      }
    }

    return debugLog;
  });
}

export async function deleteTranscriptLog(id: string): Promise<void> {
  await mutateStore(async (store) => {
    const initialCount = store.transcriptLogs.length;
    store.transcriptLogs = store.transcriptLogs.filter((log) => log.id !== id);

    if (store.transcriptLogs.length === initialCount) {
      throw new Error("Transcript log not found.");
    }
  });
}

export async function clearTranscriptLogs(sessionId?: string): Promise<void> {
  await mutateStore(async (store) => {
    store.transcriptLogs = store.transcriptLogs.filter(
      (log) => !matchesSessionId(log.sessionId, sessionId),
    );
  });
}

export async function deleteMatchedTriggerLog(id: string): Promise<void> {
  await mutateStore(async (store) => {
    const initialCount = store.matchLogs.length;
    store.matchLogs = store.matchLogs.filter((log) => log.id !== id);

    if (store.matchLogs.length === initialCount) {
      throw new Error("Matched trigger log not found.");
    }
  });
}

export async function clearMatchedTriggerLogs(sessionId?: string): Promise<void> {
  await mutateStore(async (store) => {
    store.matchLogs = store.matchLogs.filter(
      (log) => !matchesSessionId(log.sessionId, sessionId),
    );
  });
}

export async function clearWebhookDebugLogs(sessionId?: string): Promise<void> {
  await mutateStore(async (store) => {
    store.webhookDebugLogs = store.webhookDebugLogs.filter(
      (log) => !matchesSessionId(log.sessionId, sessionId),
    );
  });
}
