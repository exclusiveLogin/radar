/**
 * ---
 * layer: worker/composition
 * domain: phase-platform
 * purpose: Собирает узкие порты parse/geo phase runtime.
 * ---
 */
import type { IEventTransport } from "@radar/shared";
import { TransportEventPublisher } from "../../infrastructure/transport/transportEventPublisher.js";
import { notifyMapPushSnapshotAfterPhase } from "../../infrastructure/notifyMapPushSnapshot.js";
import { bootGeo } from "../../domain-boots/bootGeo.js";
import { CoverageEnqueuer } from "../../application/phases/coverageEnqueuer.js";
import { PhaseRunner } from "../../application/phases/phaseRunner.js";
import { createPhaseRunSession } from "../../application/phases/phaseRunSession.js";
import { createParsePhaseTool } from "../../application/parse/parsePhaseTool.js";
import { createParseExternalEnricher } from "./createParseExternalEnricher.js";
import type { PhasePlatformDeps } from "../../application/runtime/runner-platform/phasePlatformDeps.js";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import type { resolveWorkerBootstrapContext } from "./resolveWorkerBootstrapContext.js";
import type { wireParseApplication } from "./wireParseApplication.js";

type BootstrapContext = ReturnType<typeof resolveWorkerBootstrapContext>;
type ParseApplication = Awaited<ReturnType<typeof wireParseApplication>>;

/** Собирает platform deps из repository ports без передачи repository bag в runner. */
export async function wirePhasePlatform(
  context: Pick<BootstrapContext, "caps" | "needsParseStack">,
  workerRepos: WorkerDbRepositories | undefined,
  parseApplication: Pick<ParseApplication, "placeScan" | "validation">,
  eventTransport: IEventTransport,
) {
  if (!workerRepos) {
    return {
      placeEnrichmentRunner: undefined,
      parseTool: undefined,
      phaseRunSession: undefined,
      phaseRunner: undefined,
      phasePlatform: undefined,
      coverageEnqueuer: undefined,
    };
  }

  const {
    aliases,
    eventEvidence,
    eventLocations,
    messageParseWorkspaces,
    parsedEvents,
    phaseCoverage,
    phaseDefinitions,
    phaseRuns,
    placeEnrichmentJobs,
    places,
    rawMessages,
    regionAdjacency,
    regions,
  } = workerRepos;
  const hasGeo = context.caps.has("geo");
  const placeEnrichmentRunner = hasGeo
    ? await bootGeo(async ({ runner }) => {
        const { createPlaceEnrichmentEnrichers } = await import(
          "../../infrastructure/enrichers/createPlaceEnrichmentEnrichers.js"
        );
        return new runner.PlaceEnrichmentRunner(
          placeEnrichmentJobs,
          places,
          aliases,
          regions,
          createPlaceEnrichmentEnrichers(),
        );
      })
    : undefined;
  const parseTool =
    context.needsParseStack &&
    parseApplication.placeScan &&
    parseApplication.validation
    ? createParsePhaseTool({
        rawMessages,
        parsedEvents,
        messageParseWorkspaces,
        eventLocations,
        eventEvidence,
        places,
        regions,
        validation: parseApplication.validation,
        placeScan: parseApplication.placeScan,
        events: new TransportEventPublisher(eventTransport),
        externalEnricher: createParseExternalEnricher(regionAdjacency),
      })
    : undefined;
  const phaseRunSession =
    parseTool || placeEnrichmentRunner
      ? createPhaseRunSession(
          phaseRuns,
          () => void notifyMapPushSnapshotAfterPhase(),
        )
      : undefined;
  const phaseRunner =
    parseTool && phaseRunSession
      ? new PhaseRunner({
          parseTool,
          session: phaseRunSession,
          coverage: phaseCoverage,
          phaseDefinitions,
        })
      : undefined;
  const phasePlatform: PhasePlatformDeps | undefined =
    phaseRunSession
      ? {
          phases: phaseDefinitions,
          phaseRuns,
          coverage: phaseCoverage,
          placeJobs: placeEnrichmentJobs,
          session: phaseRunSession,
          parseTool,
          placeEnrichmentRunner,
        }
      : undefined;
  const coverageEnqueuer = context.needsParseStack
    ? new CoverageEnqueuer(phaseCoverage, phaseDefinitions)
    : undefined;

  return {
    placeEnrichmentRunner,
    parseTool,
    phaseRunSession,
    phaseRunner,
    phasePlatform,
    coverageEnqueuer,
  };
}
