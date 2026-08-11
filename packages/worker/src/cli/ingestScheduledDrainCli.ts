import { MONOREPO_ROOT } from "@repo/root";
import { createStepRunRequestedEvent, topicForKnownEventType } from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

/** Публикует StepRunRequested для parse (опционально --phase только для лога). */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const phaseFilter = readStringFlag(parseLongFlagsMap(process.argv), ["phase"])?.trim();

  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("parse", ["parse"]));
  if (!runtime.eventTransport) {
    throw new Error("parse-engine:ingest:drain: требуется db mode + transport");
  }

  const event = createStepRunRequestedEvent({
    stepId: "parse",
    lane: "manual",
  });
  const topic = topicForKnownEventType(event.type);
  if (!topic) throw new Error("StepRunRequested topic missing");

  await runtime.eventTransport.start();
  await runtime.eventTransport.publish(topic, [event]);
  console.log(
    `ingest drain: StepRunRequested step=parse event=${event.id}${
      phaseFilter ? ` (phase filter note=${phaseFilter})` : ""
    }`,
  );
  await runtime.shutdown?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
