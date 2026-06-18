import { normalizeTranscript } from "@/lib/normalize";
import type { TriggerSlotAliasGroup } from "@/lib/types";

const MAX_SLOT_ALIASES_PER_SOURCE = 10;

export function parseTriggerAliasText(value: string): string[] {
  return value
    .split(/\r?\n|,|，|;|；/)
    .map((alias) => alias.trim())
    .filter(Boolean);
}

export function normalizeTriggerAliases(
  aliases: string[],
  triggerPhrase?: string,
): {
  aliases: string[];
  normalizedAliases: string[];
} {
  const normalizedTriggerPhrase = triggerPhrase
    ? normalizeTranscript(triggerPhrase)
    : "";
  const seenNormalizedAliases = new Set<string>();
  const cleanedAliases: string[] = [];
  const normalizedAliases: string[] = [];

  for (const alias of aliases) {
    const cleanedAlias = alias.trim();

    if (!cleanedAlias) {
      continue;
    }

    const normalizedAlias = normalizeTranscript(cleanedAlias);

    if (!normalizedAlias) {
      continue;
    }

    if (
      normalizedAlias === normalizedTriggerPhrase ||
      seenNormalizedAliases.has(normalizedAlias)
    ) {
      continue;
    }

    seenNormalizedAliases.add(normalizedAlias);
    cleanedAliases.push(cleanedAlias);
    normalizedAliases.push(normalizedAlias);
  }

  return {
    aliases: cleanedAliases,
    normalizedAliases,
  };
}

export function formatTriggerAliasesForTextarea(aliases: string[]): string {
  return aliases.join("\n");
}

export function normalizeSlotAliasText(input: string): string {
  return input.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

export function normalizeSlotAliasGroups(
  triggerPhrase: string,
  slotAliasGroups: TriggerSlotAliasGroup[],
): TriggerSlotAliasGroup[] {
  const triggerSlots = Array.from(normalizeSlotAliasText(triggerPhrase));
  const allowedSources = new Set(triggerSlots);
  const mergedAliasesBySource = new Map<string, Set<string>>();

  for (const group of slotAliasGroups) {
    const sourceSlot = Array.from(normalizeSlotAliasText(group.source))[0] ?? "";

    if (!sourceSlot || !allowedSources.has(sourceSlot)) {
      continue;
    }

    const aliasSet = mergedAliasesBySource.get(sourceSlot) ?? new Set<string>();

    for (const alias of group.aliases) {
      const normalizedAlias = normalizeSlotAliasText(alias);

      if (!normalizedAlias) {
        continue;
      }

      const aliasSlot = Array.from(normalizedAlias)[0] ?? "";

      if (!aliasSlot || aliasSlot === sourceSlot) {
        continue;
      }

      aliasSet.add(aliasSlot);
    }

    mergedAliasesBySource.set(sourceSlot, aliasSet);
  }

  const orderedSources = Array.from(new Set(triggerSlots));

  return orderedSources
    .map((source) => ({
      source,
      aliases: Array.from(mergedAliasesBySource.get(source) ?? []).slice(
        0,
        MAX_SLOT_ALIASES_PER_SOURCE,
      ),
    }))
    .filter((group) => group.aliases.length > 0);
}

export function matchesSlotAliasGroups(
  triggerPhrase: string,
  slotAliasGroups: TriggerSlotAliasGroup[],
  transcriptText: string,
): boolean {
  const triggerSlots = Array.from(normalizeSlotAliasText(triggerPhrase));
  const transcriptSlots = Array.from(normalizeSlotAliasText(transcriptText));

  if (triggerSlots.length === 0 || transcriptSlots.length < triggerSlots.length) {
    return false;
  }

  const aliasSetBySource = new Map(
    normalizeSlotAliasGroups(triggerPhrase, slotAliasGroups).map((group) => [
      group.source,
      new Set(group.aliases),
    ]),
  );

  for (
    let transcriptStart = 0;
    transcriptStart <= transcriptSlots.length - triggerSlots.length;
    transcriptStart += 1
  ) {
    let matched = true;

    for (let offset = 0; offset < triggerSlots.length; offset += 1) {
      const sourceSlot = triggerSlots[offset];
      const transcriptSlot = transcriptSlots[transcriptStart + offset];
      const aliases = aliasSetBySource.get(sourceSlot);

      if (transcriptSlot !== sourceSlot && !aliases?.has(transcriptSlot)) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return true;
    }
  }

  return false;
}
