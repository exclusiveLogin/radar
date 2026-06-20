import { normalizeParseWorkspace } from "@radar/shared";
import type {
  IEventLocationRepository,
  IMessageParseWorkspaceRepository,
  IParsedEventRepository,
  IRegionRepository,
} from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import type { GeoValidationService } from "../parsing/geoValidationService.js";
import {
  ParseWorkspaceMessageService,
  type StoredParseWorkspace,
} from "./ParseWorkspaceMessageService.js";
import { ParseWorkspacePersistService } from "./ParseWorkspacePersistService.js";

export type ParseWorkspaceStackDeps = {
  geoCatalog: GeoCatalog;
  regions: IRegionRepository;
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
    geoCatalog: deps.geoCatalog,
    regions: deps.regions,
    validation: deps.validation,
    persist,
    loadStoredWorkspace,
  });
  return { persist, workspaceService };
}
