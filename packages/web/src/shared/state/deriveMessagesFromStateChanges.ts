import type { MessageFeedItem, StateChangeEventItem, StateLevel } from "@radar/shared";
import { STATE_LEVEL_RANK } from "@radar/shared";

function maxStateLevel(a: StateLevel, b: StateLevel): StateLevel {
  return STATE_LEVEL_RANK[a] >= STATE_LEVEL_RANK[b] ? a : b;
}

/**
 * Агрегат ленты «Сообщения» из одного потока parsed events:
 * 1 raw_message ← N parsed_events (anchors), регионы и уровень объединяются.
 */
export function deriveMessagesFromStateChanges(
  events: StateChangeEventItem[],
): MessageFeedItem[] {
  const byRaw = new Map<string, MessageFeedItem>();

  for (const event of events) {
    const existing = byRaw.get(event.rawMessageId);
    if (!existing) {
      byRaw.set(event.rawMessageId, {
        id: event.rawMessageId,
        channelKey: event.channelKey,
        channelTitle: event.channelTitle,
        postedAt: event.postedAt,
        rawText: event.rawText,
        ingestMode: "live",
        eventType: event.eventType,
        eventCategory: event.eventCategory,
        stateLevel: event.stateLevel,
        regionCodes: [...new Set(event.regionCodes)],
        repeat: event.repeat,
      });
      continue;
    }

    existing.regionCodes = [...new Set([...existing.regionCodes, ...event.regionCodes])];
    existing.stateLevel = maxStateLevel(existing.stateLevel ?? "grey", event.stateLevel);
    existing.repeat = existing.repeat || event.repeat;
    if (!existing.eventType && event.eventType) existing.eventType = event.eventType;
    if (!existing.eventCategory && event.eventCategory) {
      existing.eventCategory = event.eventCategory;
    }
  }

  return [...byRaw.values()].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}
