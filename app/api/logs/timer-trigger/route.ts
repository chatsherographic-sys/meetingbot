import { NextResponse } from "next/server";
import { clearTimerTriggerLogs, listTimerTriggerLogs } from "@/lib/store";

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
  const timerTriggerLogs = await listTimerTriggerLogs({
    sessionId: searchParams.get("sessionId") ?? undefined,
    page: parsePositiveInteger(searchParams.get("page")),
    pageSize: parsePositiveInteger(searchParams.get("pageSize")),
  });

  return NextResponse.json({
    timerTriggerLogs: timerTriggerLogs.items,
    pagination: timerTriggerLogs.pagination,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  await clearTimerTriggerLogs(searchParams.get("sessionId") ?? undefined);
  return NextResponse.json({ ok: true });
}
