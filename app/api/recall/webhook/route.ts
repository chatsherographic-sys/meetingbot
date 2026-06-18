import { NextResponse } from "next/server";
import {
  extractTranscriptTextFromWebhook,
  extractWebhookBotId,
  getWebhookEventName,
  ignoredWebhookEvents,
  isTranscriptProcessingEvent,
} from "@/lib/recall-webhook";
import {
  isStoreCorruptionError,
  findSessionIdForRecallBotId,
  getAppSettings,
  processTranscriptWebhook,
  saveWebhookDebugLog,
} from "@/lib/store";

export async function POST(request: Request) {
  const receivedAt = new Date().toISOString();
  const rawBody = await request.text();
  let rawPayload: unknown = { rawBody };
  let eventName = "unknown";
  let botId: string | null = null;
  let sessionId: string | null = null;
  let extractedTranscriptText: string | null = null;
  let transcriptExtractedAt: string | null = null;
  let shouldPersistNormalWebhookLogs = false;

  try {
    rawPayload = rawBody ? (JSON.parse(rawBody) as unknown) : {};
    eventName = getWebhookEventName(rawPayload);
    botId = extractWebhookBotId(rawPayload);
    sessionId = await findSessionIdForRecallBotId(botId);
    extractedTranscriptText = extractTranscriptTextFromWebhook(rawPayload);
    transcriptExtractedAt = new Date().toISOString();
    shouldPersistNormalWebhookLogs =
      (await getAppSettings()).storageLoggingMode === "debug";

    if (isTranscriptProcessingEvent(eventName)) {
      await processTranscriptWebhook({
        sessionId: sessionId ?? undefined,
        botId,
        transcriptText: extractedTranscriptText ?? "",
        sourceEvent: eventName,
        webhookReceivedAt: receivedAt,
        transcriptExtractedAt,
      });

      // Storage / Logging Mode should only affect what gets persisted.
      // Transcript extraction, trigger matching, cooldowns, dedupe, and chat send
      // behavior must still run for transcript events in production_minimal mode.
      if (shouldPersistNormalWebhookLogs) {
        await saveWebhookDebugLog({
          sessionId: sessionId ?? "default-session",
          eventName,
          rawPayload,
          receivedAt,
          botId,
          status: "processed",
          extractedTranscriptText,
          errorMessage: null,
        });
      }

      return NextResponse.json({ ok: true, status: "processed" });
    }

    if (ignoredWebhookEvents.has(eventName)) {
      if (shouldPersistNormalWebhookLogs) {
        await saveWebhookDebugLog({
          sessionId: sessionId ?? "default-session",
          eventName,
          rawPayload,
          receivedAt,
          botId,
          status: "ignored",
          extractedTranscriptText,
          errorMessage: null,
        });
      }

      return NextResponse.json({ ok: true, status: "ignored" });
    }

    if (shouldPersistNormalWebhookLogs) {
      await saveWebhookDebugLog({
        sessionId: sessionId ?? "default-session",
        eventName,
        rawPayload,
        receivedAt,
        botId,
        status: "unknown",
        extractedTranscriptText,
        errorMessage: null,
      });
    }

    return NextResponse.json({ ok: true, status: "unknown" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid webhook payload.";
    const shouldReturnStoreFailure = isStoreCorruptionError(error);

    try {
      await saveWebhookDebugLog({
        sessionId: sessionId ?? (await findSessionIdForRecallBotId(botId)),
        eventName,
        rawPayload,
        receivedAt,
        botId,
        status: "failed",
        extractedTranscriptText,
        errorMessage: message,
      });
    } catch (logError) {
      const logFailureMessage =
        logError instanceof Error ? logError.message : message;

      return NextResponse.json(
        {
          ok: false,
          status: "store_failed",
          error: logFailureMessage,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { ok: !shouldReturnStoreFailure, status: "failed", error: message },
      { status: shouldReturnStoreFailure ? 500 : 200 },
    );
  }
}
