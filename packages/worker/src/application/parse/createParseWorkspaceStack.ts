import type {
  IEventLocationRepository,
  IMessageParseWorkspaceRepository,
  IParsedEventRepository,
} from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { ParseWorkspaceMessageService } from "./ParseWorkspaceMessageService.js";
import { ParseWorkspacePersistService } from "./ParseWorkspacePersistService.js";

export type ParseWorkspaceStackDeps = {
  geoCatalog: GeoCatalog;
  parsedEvents: IParsedEventRepository;
  eventLocations: IEventLocationRepository;
  messageParseWorkspaces: IMessageParseWorkspaceRepository;
};

/** SSOT: persist + message service для handler, phaseRunner и тестов. */
export function createParseWorkspaceStack(deps: ParseWorkspaceStackDeps): {
  persist: ParseWorkspacePersistService;
  workspaceService: ParseWorkspaceMessageService;
} {
  const persist = new ParseWorkspacePersistService(
    deps.parsedEvents,
    deps.eventLocations,
    deps.messageParseWorkspaces,
  );
  const workspaceService = new ParseWorkspaceMessageService({
    geoCatalog: deps.geoCatalog,
    persist,
    findActiveWorkspace: async (rawMessageId) => {
      const row = await deps.messageParseWorkspaces.findActiveByRawMessageId(rawMessageId);
      if (!row) return null;
      return {
        spawnedEventIds: row.spawnedEventIds,
        candidateEventMap: row.candidateEventMap,
      };
    },
  });
  return { persist, workspaceService };
}
