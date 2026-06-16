import { NextResponse } from "next/server";
import { clearMatchedTriggerLogs, listMatchedTriggerLogs } from "@/lib/store";

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
  const status = searchParams.get("status");
  const logs = await listMatchedTriggerLogs({
    sessionId: searchParams.get("sessionId") ?? undefined,
    page: parsePositiveInteger(searchParams.get("page")),
    pageSize: parsePositiveInteger(searchParams.get("pageSize")),
    search: searchParams.get("search") ?? undefined,
    botId: searchParams.get("botId") ?? undefined,
    triggerSearch: searchParams.get("triggerSearch") ?? undefined,
    replySearch: searchParams.get("replySearch") ?? undefined,
    status:
      status === "dry_run" ||
      status === "sent" ||
      status === "failed" ||
      status === "no_active_sender_bot"
        ? status
        : undefined,
  });

  return NextResponse.json({
    matchLogs: logs.items,
    pagination: logs.pagination,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  await clearMatchedTriggerLogs(searchParams.get("sessionId") ?? undefined);
  return NextResponse.json({ ok: true });
}
