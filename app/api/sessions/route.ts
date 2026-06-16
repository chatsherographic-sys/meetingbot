import { NextResponse } from "next/server";
import { createMeetingSession, listMeetingSessions } from "@/lib/store";

export async function GET() {
  const meetingSessions = await listMeetingSessions();
  return NextResponse.json({ meetingSessions });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      zoomUrl?: string;
      notes?: string;
    };

    const meetingSession = await createMeetingSession({
      name: body.name ?? "",
      zoomUrl: body.zoomUrl ?? "",
      notes: body.notes ?? "",
    });

    return NextResponse.json({ meetingSession }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create session.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
