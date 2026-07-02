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

export type ParseWorkspaceStackDeps = {
  placeScan: IPlaceScanPort;
  regions: IRegionRepository;
  places: IPlaceRepository;
  validation: GeoValidationService;
  parsedEvents: IParsedEventRepository;
  eventLocations: IEventLocationRepository;
  messageParseWorkspaces: IMessageParseWorkspaceRepository;
};

/** SSOT: persist + message service для handler, phase runner и heal CLI. */
export function createParseWorkspaceStack(deps: ParseWorkspaceStackDeps): {
  persist: ParseWorkspacePersistService;
  workspaceService: ParseWorkspaceMessageService;
} {
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

  const workspaceService = new ParseWorkspaceMessageService({
    placeScan: deps.placeScan,
    regions: deps.regions,
    places: deps.places,
    validation: deps.validation,
    persist,
    loadStoredWorkspace,
  });
  return { persist, workspaceService };
}
