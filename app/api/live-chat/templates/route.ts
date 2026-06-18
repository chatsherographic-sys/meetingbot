import { NextResponse } from "next/server";
import {
  createLiveChatTemplate,
  listLiveChatTemplates,
} from "@/lib/store";
import type { LiveChatTemplate } from "@/lib/types";

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
  const page = parsePositiveInteger(searchParams.get("page"));
  const pageSize = parsePositiveInteger(searchParams.get("pageSize"));
  const sessionId = searchParams.get("sessionId") ?? undefined;
  const templates = await listLiveChatTemplates({
    sessionId,
    page,
    pageSize,
  });

  return NextResponse.json({
    liveChatTemplates: templates.items,
    pagination: templates.pagination,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      name?: string;
      message?: string;
      senderMode?: LiveChatTemplate["senderMode"];
      botIds?: string[];
    };

    const template = await createLiveChatTemplate({
      sessionId: body.sessionId ?? "",
      name: body.name ?? "",
      message: body.message ?? "",
      senderMode:
        body.senderMode === "all_bots"
          ? "all_bots"
          : body.senderMode === "round_robin"
            ? "round_robin"
            : "selected_bots",
      botIds: Array.isArray(body.botIds) ? body.botIds : [],
    });

    return NextResponse.json({ liveChatTemplate: template }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create live chat template.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
