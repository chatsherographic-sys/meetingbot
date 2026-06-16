import { NextResponse } from "next/server";
import { deleteTranscriptLog } from "@/lib/store";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteTranscriptLog(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete transcript log.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
