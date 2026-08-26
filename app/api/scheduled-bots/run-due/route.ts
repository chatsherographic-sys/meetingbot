import { NextResponse } from "next/server";
import {
  runDueScheduledBotJoins,
  runDueScheduledLiveChatTemplates,
} from "@/lib/store";

function isAuthorizedCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return false;
  }

  if (request.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return true;
  }

  // Query-string authorization is intentionally local-only for simple manual tests.
  if (process.env.NODE_ENV !== "production") {
    return new URL(request.url).searchParams.get("secret") === cronSecret;
  }

  return false;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const scheduledBots = await runDueScheduledBotJoins();
    const scheduledLiveChat = await runDueScheduledLiveChatTemplates();

    return NextResponse.json({
      scheduledBots,
      scheduledLiveChat,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to run due scheduled bot joins.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
