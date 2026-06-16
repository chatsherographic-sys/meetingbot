import { NextResponse } from "next/server";
import { clearWebhookDebugLogs, listWebhookDebugLogs } from "@/lib/store";

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
  const logs = await listWebhookDebugLogs({
    sessionId: searchParams.get("sessionId") ?? undefined,
    page: parsePositiveInteger(searchParams.get("page")),
    pageSize: parsePositiveInteger(searchParams.get("pageSize")),
    search: searchParams.get("search") ?? undefined,
    botId: searchParams.get("botId") ?? undefined,
    event: searchParams.get("event") ?? undefined,
    status:
      (searchParams.get("status") as
        | "processed"
        | "ignored"
        | "failed"
        | "unknown"
        | null) ?? undefined,
  });

  return NextResponse.json({
    webhookDebugLogs: logs.items,
    pagination: logs.pagination,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  await clearWebhookDebugLogs(searchParams.get("sessionId") ?? undefined);
  return NextResponse.json({ ok: true });
}
