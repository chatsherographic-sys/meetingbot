import { NextResponse } from "next/server";
import { clearTranscriptLogs, listTranscriptLogs } from "@/lib/store";

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
  const logs = await listTranscriptLogs({
    sessionId: searchParams.get("sessionId") ?? undefined,
    page: parsePositiveInteger(searchParams.get("page")),
    pageSize: parsePositiveInteger(searchParams.get("pageSize")),
    search: searchParams.get("search") ?? undefined,
    botId: searchParams.get("botId") ?? undefined,
  });

  return NextResponse.json({
    transcriptLogs: logs.items,
    pagination: logs.pagination,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  await clearTranscriptLogs(searchParams.get("sessionId") ?? undefined);
  return NextResponse.json({ ok: true });
}
