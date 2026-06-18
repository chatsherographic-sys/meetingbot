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
      // The simplified live chat sender no longer performs transcript-trigger
      // matching in the webhook path. We keep the endpoint available so existing
      // Recall bot configs do not fail, and we only persist debug records when
      // the app is explicitly running in debug storage mode.
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
