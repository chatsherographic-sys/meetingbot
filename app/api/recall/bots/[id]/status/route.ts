import { NextResponse } from "next/server";
import { getRecallBot } from "@/lib/recall";
import {
  updateRecallBotRecordError,
  updateRecallBotRecordFromResponse,
} from "@/lib/store";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing bot ID." }, { status: 400 });
  }

  try {
    const rawRecallResponse = await getRecallBot(id);
    const recallBot = await updateRecallBotRecordFromResponse({
      recallBotId: id,
      rawRecallResponse,
    });

    return NextResponse.json({ recallBot });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to refresh bot status.";

    try {
      await updateRecallBotRecordError({
        recallBotId: id,
        errorMessage: message,
      });
    } catch {
      // If the local record is missing, keep the original API error response.
    }

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
