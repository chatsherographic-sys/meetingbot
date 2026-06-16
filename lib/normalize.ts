import { normalizeChineseNumerals } from "@/lib/recall-webhook";

export function normalizeTranscript(input: string): string {
  return normalizeChineseNumerals(input.toLowerCase()).replace(
    /[\p{P}\p{S}\s]+/gu,
    "",
  );
}
