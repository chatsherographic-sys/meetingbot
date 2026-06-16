import { NextResponse } from "next/server";
import { sendLiveChat } from "@/lib/store";
import type { SenderMode } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      message?: string;
      senderMode?: SenderMode;
      senderBotIds?: string[];
    };

    const liveChatLog = await sendLiveChat({
      sessionId: body.sessionId ?? "",
      message: body.message ?? "",
      senderMode:
        body.senderMode === "specific_bots" ||
        body.senderMode === "all_bots" ||
        body.senderMode === "round_robin_bots"
          ? body.senderMode
          : "round_robin_bots",
      senderBotIds: Array.isArray(body.senderBotIds) ? body.senderBotIds : [],
    });

    return NextResponse.json({ liveChatLog }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send live chat.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
