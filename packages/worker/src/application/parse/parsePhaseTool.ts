/**
 * Domain-инструмент parse: coverage-task → raw → ParseRawMessageHandler.
 * Молотилка (UnifiedRunner) этот модуль не импортирует — только composition/PhaseDriver.
 */
import type {
  IEventEvidenceRepository,
  IEventLocationRepository,
  IEventPublisher,
  IMessageParseWorkspaceRepository,
  IParsedEventRepository,
  IPlaceRepository,
  IRawMessageRepository,
  IRegionRepository,
  IPlaceScanPort,
  PhaseCoverageTask,
  PhaseDefinitionRecord,
} from "@radar/shared";
import { ParseRawMessageHandler } from "../handlers/parseRawMessageHandler.js";
import { createParseWorkspaceMessageService } from "./createParseWorkspaceMessageService.js";
import type { ParsePhaseContext } from "./parsePhaseContext.js";
import { resolvePhaseRunKind } from "./parseWorkspaceRunModes.js";
import type { GeoValidationService } from "./geoValidationService.js";

export type ParsePhaseToolDeps = {
  rawMessages: IRawMessageRepository;
  parsedEvents: IParsedEventRepository;
  messageParseWorkspaces: IMessageParseWorkspaceRepository;
  eventLocations: IEventLocationRepository;
  eventEvidence: IEventEvidenceRepository;
  places: IPlaceRepository;
  regions: IRegionRepository;
  validation: GeoValidationService;
  placeScan: IPlaceScanPort;
  events: IEventPublisher;
};

/** Инструмент: одна задача (coverage task) → материализация parse. */
export type ParsePhaseTool = {
  run(phase: PhaseDefinitionRecord, task: PhaseCoverageTask): Promise<void>;
  /** Handler под конкретную фазу (legacy batch drain). */
  createHandler(phase: PhaseDefinitionRecord): ParseRawMessageHandler;
};

export function createParsePhaseTool(deps: ParsePhaseToolDeps): ParsePhaseTool {
  const createHandler = (phase: PhaseDefinitionRecord): ParseRawMessageHandler => {
    const phaseContext: ParsePhaseContext = {
      phaseId: phase.id,
      phaseMode: phase.enrichers.includes("llm") ? "enrich" : "baseline",
      enrichers: phase.enrichers,
      runKind: resolvePhaseRunKind(phase),
    };
    const workspaceService = createParseWorkspaceMessageService({
      placeScan: deps.placeScan,
      regions: deps.regions,
      places: deps.places,
      validation: deps.validation,
      parsedEvents: deps.parsedEvents,
      eventLocations: deps.eventLocations,
      messageParseWorkspaces: deps.messageParseWorkspaces,
    });
    return new ParseRawMessageHandler(
      workspaceService,
      deps.parsedEvents,
      deps.eventLocations,
      deps.eventEvidence,
      deps.events,
      phaseContext,
    );
  };

  return {
    createHandler,
    async run(phase, task) {
      const handler = createHandler(phase);
      const raw = await deps.rawMessages.findById(task.rawMessageId);
      if (!raw?.id) throw new Error("raw_message not found");
      await handler.handle(raw);
    },
  };
}
