import { NextResponse } from "next/server";
import { runDueTimerTriggers } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await runDueTimerTriggers({
      sessionId: searchParams.get("sessionId") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to run due timer triggers.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
