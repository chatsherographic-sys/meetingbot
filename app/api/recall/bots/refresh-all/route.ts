import { NextResponse } from "next/server";
import { getRecallBot } from "@/lib/recall";
import {
  listRecallBots,
  updateRecallBotRecordError,
  updateRecallBotRecordFromResponse,
} from "@/lib/store";

type FailedRefresh = {
  botId: string;
  error: string;
};

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const recallBots = await listRecallBots({
    sessionId: searchParams.get("sessionId") ?? undefined,
  });
  const failedBots: FailedRefresh[] = [];
  let refreshedCount = 0;

  for (const bot of recallBots.items) {
    try {
      const rawRecallResponse = await getRecallBot(bot.recallBotId);
      await updateRecallBotRecordFromResponse({
        recallBotId: bot.recallBotId,
        rawRecallResponse,
      });
      refreshedCount += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to refresh bot status.";

      failedBots.push({
        botId: bot.recallBotId,
        error: message,
      });

      try {
        await updateRecallBotRecordError({
          recallBotId: bot.recallBotId,
          errorMessage: message,
        });
      } catch {
        // Keep the original refresh error if the local record cannot be updated.
      }
    }
  }

  return NextResponse.json({
    totalBots: recallBots.items.length,
    refreshedCount,
    failedCount: failedBots.length,
    failedBots,
  });
}
