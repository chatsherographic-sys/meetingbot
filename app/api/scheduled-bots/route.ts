import { NextResponse } from "next/server";
import { createScheduledBotJoin, listScheduledBotJoins } from "@/lib/store";

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
  const scheduledBotJoins = await listScheduledBotJoins({
    sessionId: searchParams.get("sessionId") ?? undefined,
    page: parsePositiveInteger(searchParams.get("page")),
    pageSize: parsePositiveInteger(searchParams.get("pageSize")),
  });

  return NextResponse.json({
    scheduledBotJoins: scheduledBotJoins.items,
    pagination: scheduledBotJoins.pagination,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      name?: string;
      scheduledAt?: string;
      botCount?: number | string;
      botNames?: string[];
      transcriptLanguage?: string;
      enabled?: boolean;
    };

    const scheduledBotJoin = await createScheduledBotJoin({
      sessionId: body.sessionId ?? "",
      name: body.name ?? "",
      scheduledAt: body.scheduledAt ?? "",
      botCount: Number(body.botCount ?? 1),
      botNames: Array.isArray(body.botNames) ? body.botNames : [],
      transcriptLanguage: body.transcriptLanguage ?? "zh-CN",
      enabled: body.enabled ?? true,
    });

    return NextResponse.json({ scheduledBotJoin }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create scheduled bot join.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
