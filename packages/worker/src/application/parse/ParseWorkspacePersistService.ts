import type {
  EventLocation,
  FinalizeContext,
  FinalizeResult,
  IEventLocationRepository,
  IMessageParseWorkspaceRepository,
  IParsedEventRepository,
  ParsedEvent,
  ParseWorkspace,
} from "@radar/shared";
import { planFinalize } from "../../domain/parse/ParseFinalizerService.js";

/**
 * Проставляет occurredAt/action/statusCode для fold и fade на карте.
 * Без occurredAt репозиторий пишет now() — все угрозы выглядят «свежими».
 */
function stampLocationFacts(
  locations: EventLocation[],
  parsedEvent: ParsedEvent,
): EventLocation[] {
  const action =
    parsedEvent.eventType === "cleared" || parsedEvent.isActive === false
      ? "clear"
      : "raise";
  return locations.map((loc) => ({
    ...loc,
    occurredAt: loc.occurredAt ?? parsedEvent.postedAt,
    action: loc.action ?? action,
    statusCode: loc.statusCode ?? parsedEvent.eventType,
  }));
}

/** Persist finalize plan в facts + workspace row. */
export class ParseWorkspacePersistService {
  constructor(
    private readonly parsedEvents: IParsedEventRepository,
    private readonly eventLocations: IEventLocationRepository,
    private readonly workspaces: IMessageParseWorkspaceRepository,
  ) {}

  async finalize(input: {
    workspace: ParseWorkspace;
    context: FinalizeContext;
    postedAt: string;
    parserRevision: string;
    locationsByCandidateId?: Record<string, import("@radar/shared").EventLocation[]>;
  }): Promise<FinalizeResult> {
    const plan = planFinalize({
      workspace: input.workspace,
      context: input.context,
      postedAt: input.postedAt,
    });

    let inserted = 0;
    let updated = 0;
    const spawnedEventIds: string[] = [];
    const candidateEventMap: Record<string, string> = { ...input.context.candidateEventMap };

    for (const item of plan.materialized) {
      const locations = stampLocationFacts(
        input.locationsByCandidateId?.[item.candidateId] ?? [],
        item.parsedEvent,
      );
      const persisted = await this.parsedEvents.upsertById(item.parsedEventId, {
        ...item.parsedEvent,
        locations,
      });
      if (item.action === "insert") inserted += 1;
      else updated += 1;
      spawnedEventIds.push(persisted.id);
      candidateEventMap[item.candidateId] = persisted.id;
      await this.eventLocations.replaceForParsedEvent(persisted.id, locations);
    }

    let deactivated = 0;
    let deleted = 0;
    const sweepIds = [...new Set([...plan.orphanIds, ...plan.invalidIds])];
    for (const id of sweepIds) {
      if (input.context.orphanPolicy === "hard_delete") {
        await this.parsedEvents.hardDeleteById(id);
        deleted += 1;
      } else {
        await this.parsedEvents.deactivateById(id);
        deactivated += 1;
      }
    }

    await this.workspaces.saveFinalized({
      rawMessageId: input.workspace.rawMessageId,
      parserRevision: input.parserRevision,
      groomedText: input.workspace.groomedText,
      workspace: input.workspace,
      spawnedEventIds: [...new Set(spawnedEventIds)],
      candidateEventMap,
    });

    return {
      inserted,
      updated,
      deactivated,
      deleted,
      spawnedEventIds: [...new Set(spawnedEventIds)],
      candidateEventMap,
    };
  }
}
