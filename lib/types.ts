export type SenderMode =
  | "specific_bots"
  | "round_robin_bots"
  | "all_bots";

export type StorageLoggingMode = "production_minimal" | "debug";

export type MeetingSessionStatus = "draft" | "active" | "ended" | "archived";

export type MeetingSession = {
  id: string;
  name: string;
  zoomUrl: string;
  status: MeetingSessionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  notes: string;
};

export type ScheduledBotJoinStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ScheduledBotJoin = {
  id: string;
  sessionId: string;
  name: string;
  enabled: boolean;
  scheduledAt: string;
  botCount: number;
  botNames: string[];
  transcriptLanguage: string;
  status: ScheduledBotJoinStatus;
  createdBotIds: string[];
  lastRunAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimerTriggerSenderMode =
  | "round_robin_bots"
  | "specific_bots"
  | "all_bots";

export type TriggerRule = {
  id: string;
  sessionId: string;
  triggerPhrase: string;
  normalizedTrigger: string;
  replyMessage: string;
  cooldownSeconds: number;
  responseDelaySeconds: number;
  senderMode: SenderMode;
  senderBotIds: string[];
  nextSenderIndex: number;
  triggerCount: number;
  maxTriggerCount: number | null;
  enabled: boolean;
  lastMatchedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
};

export type TranscriptLog = {
  id: string;
  sessionId: string;
  botId: string | null;
  transcriptText: string;
  normalizedTranscriptText: string;
  matchedRuleIds: string[];
  sourceEvent: "transcript.data" | "transcript.partial_data";
  createdAt: string;
};

export type MatchSenderStatus =
  | "dry_run"
  | "sent"
  | "failed"
  | "no_active_sender_bot"
  | "skipped_dedupe"
  | "skipped_duplicate_sender_execution";

export type MatchSenderResult = {
  senderBotId: string | null;
  senderBotName: string | null;
  status: MatchSenderStatus;
  errorMessage: string | null;
  action: string;
};

export type MatchLog = {
  id: string;
  sessionId: string;
  botId: string | null;
  triggerExecutionId: string | null;
  sourceEvent: TranscriptLog["sourceEvent"];
  sourceWebhookBotId: string | null;
  ruleId: string;
  triggerPhrase: string;
  replyMessage: string;
  transcriptText: string;
  normalizedTranscriptText: string;
  createdAt: string;
  status: MatchSenderStatus;
  senderMode: SenderMode;
  senderBotIdsUsed: string[];
  originalSenderBotIds: string[];
  dedupedSenderBotIds: string[];
  chosenRoundRobinBotId: string | null;
  chosenRoundRobinBotName: string | null;
  previousRoundRobinIndex: number | null;
  nextRoundRobinIndex: number | null;
  responseDelaySeconds: number;
  triggerCountAfter: number | null;
  maxTriggerCount: number | null;
  autoDisabledAfterTrigger: boolean;
  sendAttemptCount: number;
  actualSendCount: number;
  warningMessages: string[];
  senderResults: MatchSenderResult[];
  errorMessage: string | null;
  action: string;
};

export type RecallBotRecord = {
  id: string;
  sessionId: string;
  recallBotId: string;
  meetingUrl: string;
  botName: string;
  transcriptLanguage: string;
  webhookUrl: string;
  status: string;
  createdAt: string;
  joinedAt: string | null;
  lastStatusCheckedAt: string | null;
  lastErrorMessage: string | null;
  lastStopAttempt: {
    endpoint: string;
    httpStatus: number | null;
    attemptedAt: string;
    recallResponseBody: unknown;
    errorMessage: string | null;
  } | null;
  createRequestPayload: Record<string, unknown>;
  rawRecallResponse: Record<string, unknown>;
};

export type TimerTrigger = {
  id: string;
  sessionId: string;
  name: string;
  enabled: boolean;
  delayMinutesAfterJoin: number;
  message: string;
  senderMode: TimerTriggerSenderMode;
  senderBotIds: string[];
  nextSenderIndex: number;
  responseDelaySeconds: number;
  maxTriggerCount: number | null;
  triggerCount: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimerTriggerLogStatus =
  | "dry_run"
  | "sent"
  | "failed"
  | "no_active_sender_bot"
  | "skipped_not_due"
  | "skipped_limit_reached";

export type TimerTriggerLog = {
  id: string;
  sessionId: string;
  timerTriggerId: string;
  timerTriggerName: string;
  scheduledFor: string;
  executedAt: string;
  message: string;
  senderMode: TimerTriggerSenderMode;
  senderBotIdUsed: string | null;
  senderBotIdsUsed: string[];
  status: TimerTriggerLogStatus;
  errorMessage: string | null;
};

export type LiveChatLog = {
  id: string;
  sessionId: string;
  message: string;
  senderMode: SenderMode;
  senderBotIdsUsed: string[];
  senderResults: MatchSenderResult[];
  status: MatchSenderStatus;
  createdAt: string;
  errorMessage: string | null;
};

export type WebhookDebugLog = {
  id: string;
  sessionId: string;
  eventName: string;
  rawPayload: unknown;
  receivedAt: string;
  botId: string | null;
  status: "processed" | "ignored" | "failed" | "unknown";
  extractedTranscriptText: string | null;
  errorMessage: string | null;
};

export type StoreData = {
  storageLoggingMode: StorageLoggingMode;
  meetingSessions: MeetingSession[];
  scheduledBotJoins: ScheduledBotJoin[];
  triggerRules: TriggerRule[];
  transcriptLogs: TranscriptLog[];
  matchLogs: MatchLog[];
  recallBots: RecallBotRecord[];
  timerTriggers: TimerTrigger[];
  timerTriggerLogs: TimerTriggerLog[];
  liveChatLogs: LiveChatLog[];
  liveChatRoundRobinIndex: number;
  webhookDebugLogs: WebhookDebugLog[];
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PaginatedResult<T> = {
  items: T[];
  pagination: PaginationMeta;
};
