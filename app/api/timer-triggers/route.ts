import { NextResponse } from "next/server";
import { clearTimerTriggers, createTimerTrigger, listTimerTriggers } from "@/lib/store";
import type { TimerTriggerSenderMode } from "@/lib/types";

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }

  return Math.floor(parsed);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const timerTriggers = await listTimerTriggers({
    sessionId: searchParams.get("sessionId") ?? undefined,
    page: parsePositiveInteger(searchParams.get("page")),
    pageSize: parsePositiveInteger(searchParams.get("pageSize")),
  });

  return NextResponse.json({
    timerTriggers: timerTriggers.items,
    pagination: timerTriggers.pagination,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      name?: string;
      delayMinutesAfterJoin?: number | string;
      message?: string;
      senderMode?: TimerTriggerSenderMode;
      senderBotIds?: string[];
      responseDelaySeconds?: number | string;
      maxTriggerCount?: number | string | null;
      enabled?: boolean;
    };

    const timerTrigger = await createTimerTrigger({
      sessionId: body.sessionId ?? "",
      name: body.name ?? "",
      delayMinutesAfterJoin: Number(body.delayMinutesAfterJoin ?? 0),
      message: body.message ?? "",
      senderMode:
        body.senderMode === "specific_bots" ||
        body.senderMode === "all_bots" ||
        body.senderMode === "round_robin_bots"
          ? body.senderMode
          : "round_robin_bots",
      senderBotIds: Array.isArray(body.senderBotIds) ? body.senderBotIds : [],
      responseDelaySeconds: Number(body.responseDelaySeconds ?? 0),
      maxTriggerCount:
        body.maxTriggerCount === undefined || body.maxTriggerCount === null
          ? null
          : Number(body.maxTriggerCount),
      enabled: body.enabled ?? true,
    });

    return NextResponse.json({ timerTrigger }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create timer trigger.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId")?.trim() ?? "";

    if (!sessionId) {
      throw new Error("Session ID is required.");
    }

    const removedCount = await clearTimerTriggers(sessionId);

    return NextResponse.json({ ok: true, removedCount });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to delete timer trigger rules.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
