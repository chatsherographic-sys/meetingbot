import { NextResponse } from "next/server";
import { sendLiveChatTemplate } from "@/lib/store";
import { recordErrorLogSafely } from "@/lib/error-log";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await sendLiveChatTemplate(id);

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to send live chat template.";

    await recordErrorLogSafely({ source: "Live chat template send", error });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
