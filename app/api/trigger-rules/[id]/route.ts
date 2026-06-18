import { NextResponse } from "next/server";
import { deleteTriggerRule, updateTriggerRule } from "@/lib/store";
import type { SenderMode, TriggerSlotAliasGroup } from "@/lib/types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      triggerPhrase?: string;
      slotAliasGroups?: TriggerSlotAliasGroup[];
      replyMessage?: string;
      cooldownSeconds?: number | string;
      responseDelaySeconds?: number | string;
      enabled?: boolean;
      senderMode?: SenderMode;
      senderBotIds?: string[];
      maxTriggerCount?: number | string | null;
    };

    const triggerRule = await updateTriggerRule(id, {
      triggerPhrase: body.triggerPhrase,
      aliases: [],
      slotAliasGroups: Array.isArray(body.slotAliasGroups)
        ? body.slotAliasGroups
        : undefined,
      replyMessage: body.replyMessage,
      cooldownSeconds:
        body.cooldownSeconds === undefined
          ? undefined
          : Number(body.cooldownSeconds),
      responseDelaySeconds:
        body.responseDelaySeconds === undefined
          ? undefined
          : Number(body.responseDelaySeconds),
      enabled: body.enabled,
      senderMode: body.senderMode,
      senderBotIds: Array.isArray(body.senderBotIds) ? body.senderBotIds : undefined,
      maxTriggerCount:
        body.maxTriggerCount === undefined
          ? undefined
          : body.maxTriggerCount === null
            ? null
            : Number(body.maxTriggerCount),
    });

    return NextResponse.json({ triggerRule });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update trigger rule.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteTriggerRule(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete trigger rule.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
