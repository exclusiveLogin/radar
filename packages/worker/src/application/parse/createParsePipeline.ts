import type { IPlaceScanPort, IRegionRepository, PhaseDefinitionRecord, PlaceScanEntry, IPlaceRepository } from "@radar/shared";
import {
  InMemoryEventLocationRepository,
  InMemoryMessageParseWorkspaceRepository,
  InMemoryParsedEventRepository,
  InMemoryPlaceAliasRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../../infrastructure/testing/inMemoryRepositories.js";
import { createParseWorkspaceMessageService } from "./createParseWorkspaceMessageService.js";
import { createTestGeoValidation } from "./createTestGeoValidation.js";
import { ParsePipelineService } from "./parsePipelineService.js";
import { PlaceScanService } from "../../domain/parse/geo/placeScanService.js";

/** Конфиг worker_threads: сериализуемые ingestParse-фазы + scan entries. */
export type ParsePipelineWorkerConfig = {
  ingestParsePhases: PhaseDefinitionRecord[];
  placeScanEntries: PlaceScanEntry[];
  placeScanRevision: string;
};

export type CreateParsePipelineDeps = {
  placeScan: IPlaceScanPort;
  regions: IRegionRepository;
  ingestParsePhases: PhaseDefinitionRecord[];
  parsedEvents?: InMemoryParsedEventRepository;
  eventLocations?: InMemoryEventLocationRepository;
  messageParseWorkspaces?: InMemoryMessageParseWorkspaceRepository;
  places?: IPlaceRepository;
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
  const places = deps.places ?? new InMemoryPlaceRepository();
  const validation = createTestGeoValidation(
    deps.regions,
    places,
    deps.aliases ?? new InMemoryPlaceAliasRepository(),
  );

  const workspaceService = createParseWorkspaceMessageService({
    placeScan: deps.placeScan,
    regions: deps.regions,
    places,
    validation,
    parsedEvents,
    eventLocations,
    messageParseWorkspaces,
  });

  const pipeline = new ParsePipelineService({
    workspaceService,
    regions: deps.regions,
    places,
    validation,
    ingestParsePhases: deps.ingestParsePhases,
  });

  return { pipeline };
}

/** Сборка в worker_thread (in-memory stack). */
export function createParsePipelineInWorker(
  config: ParsePipelineWorkerConfig,
): ParsePipelineService {
  const placeScan = new PlaceScanService(config.placeScanEntries, config.placeScanRevision);
  return createParsePipeline({
    placeScan,
    regions: new InMemoryRegionRepository(),
    ingestParsePhases: config.ingestParsePhases,
  }).pipeline;
}
