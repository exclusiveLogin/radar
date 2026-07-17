import { normalizeParseWorkspace } from "@radar/shared";
import type {
  IEventLocationRepository,
  IMessageParseWorkspaceRepository,
  IParsedEventRepository,
  IPlaceRepository,
  IRegionRepository,
  IPlaceScanPort,
} from "@radar/shared";
import type { GeoValidationService } from "./geoValidationService.js";
import {
  ParseWorkspaceMessageService,
  type StoredParseWorkspace,
} from "./ParseWorkspaceMessageService.js";
import { ParseWorkspacePersistService } from "./ParseWorkspacePersistService.js";

export type ParseWorkspaceMessageServiceDeps = {
  placeScan: IPlaceScanPort;
  regions: IRegionRepository;
  places: IPlaceRepository;
  validation: GeoValidationService;
  parsedEvents: IParsedEventRepository;
  eventLocations: IEventLocationRepository;
  messageParseWorkspaces: IMessageParseWorkspaceRepository;
};

/**
 * Собирает ParseWorkspaceMessageService: persist — приватный коллаборатор,
 * наружу не протекает (SSOT для handler, phase tool и heal CLI).
 */
export function createParseWorkspaceMessageService(
  deps: ParseWorkspaceMessageServiceDeps,
): ParseWorkspaceMessageService {
  const persist = new ParseWorkspacePersistService(
    deps.parsedEvents,
    deps.eventLocations,
    deps.messageParseWorkspaces,
  );

  const loadStoredWorkspace = async (
    rawMessageId: string,
  ): Promise<StoredParseWorkspace | null> => {
    const row = await deps.messageParseWorkspaces.findActiveByRawMessageId(rawMessageId);
    if (!row) return null;
    return {
      workspace: normalizeParseWorkspace(row.workspace),
      spawnedEventIds: row.spawnedEventIds,
      candidateEventMap: row.candidateEventMap,
      parserRevision: row.parserRevision,
      groomedText: row.groomedText,
    };
  };

  return new ParseWorkspaceMessageService({
    placeScan: deps.placeScan,
    regions: deps.regions,
    places: deps.places,
    validation: deps.validation,
    persist,
    loadStoredWorkspace,
  });
}
