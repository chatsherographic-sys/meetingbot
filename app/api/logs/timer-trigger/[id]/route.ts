import { NextResponse } from "next/server";
import { deleteTimerTriggerLog } from "@/lib/store";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteTimerTriggerLog(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to delete timer trigger log.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
