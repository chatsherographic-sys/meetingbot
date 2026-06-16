import { NextResponse } from "next/server";
import { isBotActiveStatus } from "@/lib/bot-status";
import {
  getFriendlyRecallStopErrorMessage,
  getRecallBot,
  RecallApiError,
  stopRecallBot,
} from "@/lib/recall";
import {
  listRecallBots,
  updateRecallBotRecordError,
  updateRecallBotRecordFromResponse,
} from "@/lib/store";

type FailedStop = {
  botId: string;
  error: string;
};

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const allSessions = searchParams.get("allSessions") === "true";
  const recallBots = await listRecallBots({
    pageSize: 1000,
    sessionId: allSessions
      ? undefined
      : searchParams.get("sessionId") ?? undefined,
  });
  const activeBots = recallBots.items.filter((bot) =>
    isBotActiveStatus(bot.status),
  );
  const failedBots: FailedStop[] = [];
  let stoppedCount = 0;

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
        await updateRecallBotRecordFromResponse({
          recallBotId: bot.recallBotId,
          rawRecallResponse: latestRecallResponse,
          stopAttempt,
        });
      } catch (refreshError) {
        const refreshMessage =
          refreshError instanceof Error
            ? refreshError.message
            : "Failed to refresh bot status after stop.";

        await updateRecallBotRecordError({
          recallBotId: bot.recallBotId,
          errorMessage: `Stop command succeeded, but follow-up status refresh failed: ${refreshMessage}`,
          stopAttempt,
        });
      }

      stoppedCount += 1;
    } catch (error) {
      const exactMessage =
        error instanceof Error ? error.message : "Failed to stop bot.";
      const friendlyMessage = getFriendlyRecallStopErrorMessage(error);
      const message = friendlyMessage
        ? `${friendlyMessage} Recall error: ${exactMessage}`
        : exactMessage;
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

      failedBots.push({
        botId: bot.recallBotId,
        error: message,
      });

      try {
        await updateRecallBotRecordError({
          recallBotId: bot.recallBotId,
          errorMessage: message,
          stopAttempt,
        });
      } catch {
        // Keep the Recall stop error as the main failure if the local update fails.
      }
    }
  }

  return NextResponse.json({
    totalActiveBots: activeBots.length,
    stoppedCount,
    failedCount: failedBots.length,
    failedBots,
  });
}
