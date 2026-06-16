import { NextResponse } from "next/server";
import { listRecallBots } from "@/lib/store";

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
  const recallBots = await listRecallBots({
    sessionId: searchParams.get("sessionId") ?? undefined,
    page: parsePositiveInteger(searchParams.get("page")),
    pageSize: parsePositiveInteger(searchParams.get("pageSize")),
    search: searchParams.get("search") ?? undefined,
    botId: searchParams.get("botId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    name: searchParams.get("name") ?? undefined,
    meetingUrl: searchParams.get("meetingUrl") ?? undefined,
  });

  return NextResponse.json({
    recallBots: recallBots.items,
    pagination: recallBots.pagination,
  });
}
