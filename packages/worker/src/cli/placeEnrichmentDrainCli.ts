import { MONOREPO_ROOT } from "@repo/root";
import { createStepRunRequestedEvent, topicForKnownEventType } from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

/** Публикует StepRunRequested для geo-enrich. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const phaseFilter = readStringFlag(flags, ["phase"])?.trim();

  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("geo", ["geo"]));
  if (!runtime.eventTransport) {
    throw new Error("parse-engine:geo:drain: требуется db mode + transport");
  }

  const event = createStepRunRequestedEvent({
    stepId: "geo-enrich",
    lane: "manual",
  });
  const topic = topicForKnownEventType(event.type);
  if (!topic) throw new Error("StepRunRequested topic missing");

  await runtime.eventTransport.start();
  await runtime.eventTransport.publish(topic, [event]);
  console.log(
    `geo drain: StepRunRequested step=geo-enrich event=${event.id}${
      phaseFilter ? ` (phase note=${phaseFilter})` : ""
    }`,
  );
  await runtime.shutdown?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
