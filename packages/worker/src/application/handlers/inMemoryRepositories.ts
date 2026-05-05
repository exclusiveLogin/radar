import type {
  EventLocation,
  IEventLocationRepository,
  IParsedEventRepository,
  IRawMessageRepository,
  ParsedEvent,
  RawMessage,
} from "@radar/shared";
import { randomUUID } from "node:crypto";

export class InMemoryRawMessageRepository implements IRawMessageRepository {
  private readonly byHash = new Map<string, { id: string; raw: RawMessage }>();

  async upsert(raw: RawMessage): Promise<{ inserted: boolean; id: string }> {
    const existing = this.byHash.get(raw.hash);
    if (existing) return { inserted: false, id: existing.id };
    const id = randomUUID();
    this.byHash.set(raw.hash, { id, raw });
    return { inserted: true, id };
  }
}

export class InMemoryParsedEventRepository implements IParsedEventRepository {
  private readonly rows = new Map<string, ParsedEvent>();

  async upsert(parsed: ParsedEvent): Promise<{ id: string }> {
    const id = randomUUID();
    this.rows.set(id, parsed);
    return { id };
  }
}

export class InMemoryEventLocationRepository implements IEventLocationRepository {
  private readonly rows = new Map<string, EventLocation[]>();

  async replaceForParsedEvent(parsedEventId: string, locations: EventLocation[]): Promise<void> {
    this.rows.set(parsedEventId, locations);
  }
}
