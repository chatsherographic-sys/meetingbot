import { NextResponse } from "next/server";
import { summarizeRecallBotDetailsResponse } from "@/lib/recall-diagnostics";
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
    const botDetailsDiagnostics =
      summarizeRecallBotDetailsResponse(rawRecallResponse);

    return NextResponse.json({
      recallBot,
      botDetailsDiagnostics,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to check bot details.";

    try {
      await updateRecallBotRecordError({
        recallBotId: id,
        errorMessage: message,
      });
    } catch {
      // Keep the Recall API failure as the main response if the local update fails.
    }

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
