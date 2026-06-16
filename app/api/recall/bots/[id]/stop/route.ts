import { NextResponse } from "next/server";
import {
  getFriendlyRecallStopErrorMessage,
  getRecallBot,
  RecallApiError,
  stopRecallBot,
} from "@/lib/recall";
import {
  getRecallBotRecordByIdOrRecallBotId,
  updateRecallBotRecordError,
  updateRecallBotRecordFromResponse,
} from "@/lib/store";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing bot ID." }, { status: 400 });
  }

  try {
    const botRecord = await getRecallBotRecordByIdOrRecallBotId(id);

    if (!botRecord) {
      throw new Error("Created bot record not found.");
    }

    const stopStartedAt = new Date().toISOString();
    const stopResult = await stopRecallBot(botRecord.recallBotId);
    const stopAttempt = {
      endpoint: stopResult.endpoint,
      httpStatus: stopResult.httpStatus,
      attemptedAt: stopStartedAt,
      recallResponseBody: stopResult.responseBody,
      errorMessage: null,
    };

    let recallBot;

    try {
      const latestRecallResponse = await getRecallBot(botRecord.recallBotId);
      recallBot = await updateRecallBotRecordFromResponse({
        recallBotId: botRecord.recallBotId,
        rawRecallResponse: latestRecallResponse,
        stopAttempt,
      });
    } catch (refreshError) {
      const refreshMessage =
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to refresh bot status after stop.";

      recallBot = await updateRecallBotRecordError({
        recallBotId: botRecord.recallBotId,
        errorMessage: `Stop command succeeded, but follow-up status refresh failed: ${refreshMessage}`,
        stopAttempt,
      });
    }

    return NextResponse.json({ recallBot });
  } catch (error) {
    const exactMessage =
      error instanceof Error ? error.message : "Failed to stop bot.";
    const friendlyMessage = getFriendlyRecallStopErrorMessage(error);
    const message = friendlyMessage
      ? `${friendlyMessage} Recall error: ${exactMessage}`
      : exactMessage;
    const resolvedBot = await getRecallBotRecordByIdOrRecallBotId(id).catch(
      () => null,
    );
    const recallBotId = resolvedBot?.recallBotId ?? id;
    const stopAttempt =
      error instanceof RecallApiError
        ? {
            endpoint: error.endpoint,
            httpStatus: error.httpStatus,
            attemptedAt: new Date().toISOString(),
            recallResponseBody: error.responseBody,
            errorMessage: exactMessage,
          }
        : undefined;

    try {
      await updateRecallBotRecordError({
        recallBotId,
        errorMessage: message,
        stopAttempt,
      });
    } catch {
      // If the local record is missing, keep the original API error response.
    }

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
