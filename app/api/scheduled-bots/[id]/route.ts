import { NextResponse } from "next/server";
import { deleteScheduledBotJoin, updateScheduledBotJoin } from "@/lib/store";
import type { ScheduledBotJoinStatus } from "@/lib/types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      sessionId?: string;
      name?: string;
      scheduledAt?: string;
      botCount?: number | string;
      botNames?: string[];
      transcriptLanguage?: string;
      enabled?: boolean;
      status?: ScheduledBotJoinStatus;
    };

    const scheduledBotJoin = await updateScheduledBotJoin(id, {
      sessionId: body.sessionId,
      name: body.name,
      scheduledAt: body.scheduledAt,
      botCount:
        body.botCount === undefined ? undefined : Number(body.botCount),
      botNames: Array.isArray(body.botNames) ? body.botNames : undefined,
      transcriptLanguage: body.transcriptLanguage,
      enabled: body.enabled,
      status: body.status,
    });

    return NextResponse.json({ scheduledBotJoin });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update scheduled bot join.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteScheduledBotJoin(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to delete scheduled bot join.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
