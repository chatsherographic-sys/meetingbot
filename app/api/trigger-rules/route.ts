import { NextResponse } from "next/server";
import { createTriggerRule, listTriggerRules } from "@/lib/store";
import type { SenderMode } from "@/lib/types";

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
  const search = searchParams.get("search") ?? undefined;
  const status = searchParams.get("status");
  const rules = await listTriggerRules({
    sessionId: searchParams.get("sessionId") ?? undefined,
    page,
    pageSize,
    search,
    triggerSearch: searchParams.get("triggerSearch") ?? undefined,
    replySearch: searchParams.get("replySearch") ?? undefined,
    status:
      status === "enabled" || status === "disabled" ? status : undefined,
  });

  return NextResponse.json({
    triggerRules: rules.items,
    pagination: rules.pagination,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      triggerPhrase?: string;
      replyMessage?: string;
      cooldownSeconds?: number | string;
      responseDelaySeconds?: number | string;
      senderMode?: SenderMode;
      senderBotIds?: string[];
      maxTriggerCount?: number | string | null;
    };

    const rule = await createTriggerRule({
      sessionId: body.sessionId ?? "",
      triggerPhrase: body.triggerPhrase ?? "",
      replyMessage: body.replyMessage ?? "",
      cooldownSeconds: Number(body.cooldownSeconds ?? 0),
      responseDelaySeconds: Number(body.responseDelaySeconds ?? 0),
      senderMode:
        body.senderMode === "specific_bots" ||
        body.senderMode === "all_bots" ||
        body.senderMode === "round_robin_bots"
          ? body.senderMode
          : "round_robin_bots",
      senderBotIds: Array.isArray(body.senderBotIds) ? body.senderBotIds : [],
      maxTriggerCount:
        body.maxTriggerCount === undefined || body.maxTriggerCount === null
          ? null
          : Number(body.maxTriggerCount),
    });

    return NextResponse.json({ triggerRule: rule }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create trigger rule.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
