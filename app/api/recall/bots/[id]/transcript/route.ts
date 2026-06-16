import { NextResponse } from "next/server";
import { summarizeRecallBotTranscriptResponse } from "@/lib/recall-diagnostics";
import { getRecallBotTranscript } from "@/lib/recall";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing bot ID." }, { status: 400 });
  }

  try {
    const rawResponse = await getRecallBotTranscript(id);
    const transcriptDiagnostics =
      summarizeRecallBotTranscriptResponse(rawResponse);

    return NextResponse.json({ transcriptDiagnostics });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to check bot transcript.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
