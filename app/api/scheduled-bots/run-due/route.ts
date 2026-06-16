import { NextResponse } from "next/server";
import { runDueScheduledBotJoins } from "@/lib/store";

export async function POST() {
  try {
    const result = await runDueScheduledBotJoins();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to run due scheduled bot joins.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
