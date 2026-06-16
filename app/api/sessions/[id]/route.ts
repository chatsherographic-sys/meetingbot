import { NextResponse } from "next/server";
import { deleteMeetingSession, updateMeetingSession } from "@/lib/store";
import type { MeetingSessionStatus } from "@/lib/types";

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
      zoomUrl?: string;
      notes?: string;
      status?: MeetingSessionStatus;
    };

    const meetingSession = await updateMeetingSession(id, {
      name: body.name,
      zoomUrl: body.zoomUrl,
      notes: body.notes,
      status: body.status,
    });

    return NextResponse.json({ meetingSession });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update session.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteMeetingSession(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete session.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
