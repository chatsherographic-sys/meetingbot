import { NextResponse } from "next/server";
import { clearLiveChatLogs, listLiveChatLogs } from "@/lib/store";

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
  const liveChatLogs = await listLiveChatLogs({
    sessionId: searchParams.get("sessionId") ?? undefined,
    page: parsePositiveInteger(searchParams.get("page")),
    pageSize: parsePositiveInteger(searchParams.get("pageSize")),
  });

  return NextResponse.json({
    liveChatLogs: liveChatLogs.items,
    pagination: liveChatLogs.pagination,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  await clearLiveChatLogs(searchParams.get("sessionId") ?? undefined);
  return NextResponse.json({ ok: true });
}
