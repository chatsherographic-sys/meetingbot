import { NextResponse } from "next/server";
import { deleteRecallBotRecord, updateRecallBotAutoLeave } from "@/lib/store";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteRecallBotRecord(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete bot record.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { leaveAt?: string | null };
    const leaveAt =
      typeof body.leaveAt === "string" && body.leaveAt.trim()
        ? body.leaveAt
        : null;
    const recallBot = await updateRecallBotAutoLeave({
      idOrRecallBotId: id,
      leaveAt,
    });

    return NextResponse.json({ recallBot });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update bot auto leave.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
