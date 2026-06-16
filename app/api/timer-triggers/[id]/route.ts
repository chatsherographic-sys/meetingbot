import { NextResponse } from "next/server";
import { deleteTimerTrigger, updateTimerTrigger } from "@/lib/store";
import type { TimerTriggerSenderMode } from "@/lib/types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      delayMinutesAfterJoin?: number | string;
      message?: string;
      senderMode?: TimerTriggerSenderMode;
      senderBotIds?: string[];
      responseDelaySeconds?: number | string;
      maxTriggerCount?: number | string | null;
      enabled?: boolean;
    };

    const timerTrigger = await updateTimerTrigger(id, {
      name: body.name,
      delayMinutesAfterJoin:
        body.delayMinutesAfterJoin === undefined
          ? undefined
          : Number(body.delayMinutesAfterJoin),
      message: body.message,
      senderMode: body.senderMode,
      senderBotIds: Array.isArray(body.senderBotIds) ? body.senderBotIds : undefined,
      responseDelaySeconds:
        body.responseDelaySeconds === undefined
          ? undefined
          : Number(body.responseDelaySeconds),
      maxTriggerCount:
        body.maxTriggerCount === undefined
          ? undefined
          : body.maxTriggerCount === null
            ? null
            : Number(body.maxTriggerCount),
      enabled: body.enabled,
    });

    return NextResponse.json({ timerTrigger });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update timer trigger.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteTimerTrigger(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete timer trigger.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
