import type { IRegionRepository, PhaseDefinitionRecord } from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import {
  InMemoryEventLocationRepository,
  InMemoryMessageParseWorkspaceRepository,
  InMemoryParsedEventRepository,
  InMemoryPlaceAliasRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../handlers/inMemoryRepositories.js";
import { createParseWorkspaceStack } from "../parse/createParseWorkspaceStack.js";
import { createTestGeoValidation } from "../parse/createTestGeoValidation.js";
import { ParsePipelineService } from "./parsePipelineService.js";

/** Конфиг worker_threads: сериализуемые ingestParse-фазы манифеста. */
export type ParsePipelineWorkerConfig = {
  ingestParsePhases: PhaseDefinitionRecord[];
};

export type CreateParsePipelineDeps = {
  regions: IRegionRepository;
  geoCatalog: GeoCatalog;
  ingestParsePhases: PhaseDefinitionRecord[];
  parsedEvents?: InMemoryParsedEventRepository;
  eventLocations?: InMemoryEventLocationRepository;
  messageParseWorkspaces?: InMemoryMessageParseWorkspaceRepository;
  places?: InMemoryPlaceRepository;
  aliases?: InMemoryPlaceAliasRepository;
};

/**
 * Offline parse service — prod-parity через ParseWorkspaceMessageService + манифест фаз.
 */
export function createParsePipeline(deps: CreateParsePipelineDeps): {
  pipeline: ParsePipelineService;
} {
  const parsedEvents = deps.parsedEvents ?? new InMemoryParsedEventRepository();
  const eventLocations = deps.eventLocations ?? new InMemoryEventLocationRepository();
  const messageParseWorkspaces =
    deps.messageParseWorkspaces ?? new InMemoryMessageParseWorkspaceRepository();
  const validation = createTestGeoValidation(
    deps.regions,
    deps.places ?? new InMemoryPlaceRepository(),
    deps.aliases ?? new InMemoryPlaceAliasRepository(),
  );

  const { workspaceService } = createParseWorkspaceStack({
    geoCatalog: deps.geoCatalog,
    regions: deps.regions,
    validation,
    parsedEvents,
    eventLocations,
    messageParseWorkspaces,
  });

  const pipeline = new ParsePipelineService({
    workspaceService,
    regions: deps.regions,
    geoCatalog: deps.geoCatalog,
    validation,
    ingestParsePhases: deps.ingestParsePhases,
  });

  return { pipeline };
}

/** Сборка в worker_thread (in-memory stack). */
export function createParsePipelineInWorker(
  config: ParsePipelineWorkerConfig,
  geoCatalog: GeoCatalog,
): ParsePipelineService {
  return createParsePipeline({
    geoCatalog,
    regions: new InMemoryRegionRepository(),
    ingestParsePhases: config.ingestParsePhases,
  }).pipeline;
}
