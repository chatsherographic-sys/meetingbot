import { normalizeSlotAliasGroups } from "@/lib/trigger-aliases";
import type { TriggerSlotAliasGroup } from "@/lib/types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function extractOpenAIResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const topLevelOutputText = (payload as { output_text?: unknown }).output_text;

  if (
    typeof topLevelOutputText === "string" &&
    topLevelOutputText.trim().length > 0
  ) {
    return topLevelOutputText.trim();
  }

  const output = (payload as { output?: unknown }).output;

  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }

      const text = (contentItem as { text?: unknown }).text;

      if (typeof text === "string" && text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return null;
}

function parseAliasSuggestionResponse(
  responseText: string,
  triggerPhrase: string,
): {
  aliases: string[];
  slotAliasGroups: TriggerSlotAliasGroup[];
} {
  const parsed = JSON.parse(responseText) as unknown;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAI alias suggestion response was not a JSON object.");
  }

  const aliases = (parsed as { aliases?: unknown }).aliases;
  const slotAliasGroups = (parsed as { slotAliasGroups?: unknown }).slotAliasGroups;

  if (!Array.isArray(aliases)) {
    throw new Error(
      "OpenAI alias suggestion response did not contain an aliases array.",
    );
  }

  const normalizedSlotAliasGroups = normalizeSlotAliasGroups(
    triggerPhrase,
    Array.isArray(slotAliasGroups)
      ? slotAliasGroups
          .filter((group) => group && typeof group === "object")
          .map((group) => ({
            source: String((group as { source?: unknown }).source ?? "").trim(),
            aliases: Array.isArray((group as { aliases?: unknown }).aliases)
              ? (group as { aliases: unknown[] }).aliases.map((alias) =>
                  String(alias ?? "").trim(),
                )
              : [],
          }))
      : [],
  );
  return {
    aliases: [],
    slotAliasGroups: normalizedSlotAliasGroups,
  };
}

export function getOpenAIAliasModel(): string {
  return process.env.OPENAI_ALIAS_MODEL?.trim() || "gpt-5-nano";
}

export function isOpenAIAliasSuggestionConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function suggestTriggerAliases(
  triggerPhrase: string,
): Promise<{
  aliases: string[];
  slotAliasGroups: TriggerSlotAliasGroup[];
}> {
  const trimmedTriggerPhrase = triggerPhrase.trim();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();

  if (!openAiApiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  if (!trimmedTriggerPhrase) {
    throw new Error("Trigger phrase is required.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: getOpenAIAliasModel(),
      input: [
        {
          role: "system",
          content:
            "You generate short trigger alias suggestions for admin review. Return one JSON object only with fields aliases and slotAliasGroups. aliases should be an empty array. For Chinese trigger phrases, generate slotAliasGroups only. Each slotAliasGroups item must represent one unique source character or sound slot from the trigger phrase in original order. Return 8 to 10 useful aliases for EACH unique source character or sound slot whenever possible, not 8 to 10 aliases total across the whole phrase. Preserve trigger order. Do not generate all combinations. For repeated same-sound slots, return one group for that repeated sound only and let it be reused. Focus on useful Mandarin ASR mishearings, same-pronunciation Chinese words, close-pronunciation Chinese words, and common speech-to-text mistakes. Avoid obvious variants already covered by normalization, including spacing variants, symbol variants, and simple number variants that normalize the same way as the trigger phrase. Keep aliases short. If the trigger phrase is not suitable for slot groups, return aliases as [] and slotAliasGroups as []. Do not explain anything.",
        },
        {
          role: "user",
          content:
            `Trigger phrase: ${trimmedTriggerPhrase}\n` +
            "Requirement: return 8 to 10 aliases for EACH unique source slot when possible. " +
            "Example for 加一: 加 should have around 8 to 10 aliases, and 一 should also have around 8 to 10 aliases. " +
            "Example for 六六六: only one 六 group is needed, but that 六 group should still have around 8 to 10 aliases.",
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "trigger_aliases",
          strict: true,
          schema: {
            type: "object",
            properties: {
              aliases: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              slotAliasGroups: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                    },
                    aliases: {
                      type: "array",
                      maxItems: 10,
                      items: {
                        type: "string",
                      },
                    },
                  },
                  required: ["source", "aliases"],
                  additionalProperties: false,
                },
              },
            },
            required: ["aliases", "slotAliasGroups"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const payload = (await response.json()) as {
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? "OpenAI alias suggestion request failed.",
    );
  }

  const responseText = extractOpenAIResponseText(payload);

  if (!responseText) {
    throw new Error("OpenAI alias suggestion response was empty.");
  }

  const aliasSuggestion = parseAliasSuggestionResponse(
    responseText,
    trimmedTriggerPhrase,
  );

  if (
    aliasSuggestion.aliases.length === 0 &&
    aliasSuggestion.slotAliasGroups.length === 0
  ) {
    throw new Error("OpenAI did not return any usable aliases.");
  }

  return aliasSuggestion;
}
