import { NextResponse } from "next/server";
import { deleteLiveChatLog } from "@/lib/store";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteLiveChatLog(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete live chat log.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
