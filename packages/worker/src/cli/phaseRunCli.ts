/**
 * Запуск фазы по phase_id через StepRunRequested (worker daemon будит step).
 *
 * Usage:
 *   npm run parse-engine:phase:run -- --phase=llm
 *   npm run parse-engine:phase:run -- --phase=catalog --isolate
 */
import { MONOREPO_ROOT } from "@repo/root";
import {
  createStepRunRequestedEvent,
  stepIdForPhaseScope,
  topicForKnownEventType,
} from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { hasAnyFlag, parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

export async function runPhaseCli(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const map = parseLongFlagsMap(process.argv);
  const phaseId =
    readStringFlag(map, ["phase", "stage"])?.trim() ??
    (() => {
      console.error("parse-engine:phase:run: нужен --phase=<id>");
      process.exit(1);
    })();

  const isolate = hasAnyFlag(map, ["isolate"]);

  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("parse", ["parse", "geo"]));
  if (!runtime.dataSource || !runtime.workerRepos || !runtime.eventTransport) {
    console.error("parse-engine:phase:run: нужен RADAR_STORAGE_MODE=db + transport");
    process.exit(1);
  }

  const phase = await runtime.workerRepos.phaseDefinitions.findById(phaseId);
  if (!phase) {
    console.error(`Фаза '${phaseId}' не найдена. npm run phase:manifest:import`);
    process.exit(1);
  }

  const stepId = stepIdForPhaseScope(phase.scope);
  const event = createStepRunRequestedEvent({
    stepId,
    lane: "manual",
    isolate,
  });
  const topic = topicForKnownEventType(event.type);
  if (!topic) {
    console.error("StepRunRequested topic missing");
    process.exit(1);
  }

  await runtime.eventTransport.start();
  await runtime.eventTransport.publish(topic, [event]);
  console.log(
    `phase:run published StepRunRequested step=${stepId} phase=${phaseId} isolate=${isolate} event=${event.id}`,
  );
  await runtime.shutdown?.();
}

runPhaseCli().catch((err) => {
  console.error(err);
  process.exit(1);
});
