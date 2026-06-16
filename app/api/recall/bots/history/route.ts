import { NextResponse } from "next/server";
import { clearRecallBotHistory } from "@/lib/store";

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await clearRecallBotHistory(
      searchParams.get("sessionId") ?? undefined,
    );
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to clear bot history.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
