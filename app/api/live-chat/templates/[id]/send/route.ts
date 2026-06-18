import { NextResponse } from "next/server";
import { sendLiveChatTemplate } from "@/lib/store";

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

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
