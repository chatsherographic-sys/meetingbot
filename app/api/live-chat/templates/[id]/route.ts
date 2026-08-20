import { NextResponse } from "next/server";
import {
  deleteLiveChatTemplate,
  updateLiveChatTemplate,
} from "@/lib/store";
import type { LiveChatTemplate, LiveChatTemplateTarget } from "@/lib/types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      message?: string;
      senderMode?: LiveChatTemplate["senderMode"];
      botIds?: string[];
      botTargets?: LiveChatTemplateTarget[];
    };

    const liveChatTemplate = await updateLiveChatTemplate(id, {
      name: body.name,
      message: body.message,
      senderMode:
        body.senderMode === undefined
          ? undefined
          : body.senderMode === "all_bots"
            ? "all_bots"
            : body.senderMode === "round_robin"
              ? "round_robin"
              : "selected_bots",
      botIds: Array.isArray(body.botIds) ? body.botIds : undefined,
      botTargets: Array.isArray(body.botTargets) ? body.botTargets : undefined,
    });

    return NextResponse.json({ liveChatTemplate });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update live chat template.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteLiveChatTemplate(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to delete live chat template.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
