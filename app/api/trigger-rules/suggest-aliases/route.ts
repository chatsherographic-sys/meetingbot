import { NextResponse } from "next/server";
import { suggestTriggerAliases } from "@/lib/openai-alias-suggestions";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      triggerPhrase?: string;
    };
    const triggerPhrase = body.triggerPhrase?.trim() ?? "";

    if (!triggerPhrase) {
      throw new Error("Trigger phrase is required.");
    }

    const suggestion = await suggestTriggerAliases(triggerPhrase);

    return NextResponse.json({
      aliases: suggestion.aliases,
      slotAliasGroups: suggestion.slotAliasGroups,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to suggest trigger aliases.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
