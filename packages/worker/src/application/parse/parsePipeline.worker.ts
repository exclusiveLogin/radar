import { parentPort, workerData } from "node:worker_threads";
import type { ParsePipelineInput } from "./parsePipelineService.js";
import type { ParsePipelineResult } from "./parsePipelineService.js";
import {
  createParsePipelineInWorker,
  type ParsePipelineWorkerConfig,
} from "./createParsePipeline.js";
import { GF_P6_SCAN_ENTRIES } from "../../domain/parse/geo/testPlaceScanFixture.js";

type WorkerRequest = {
  type: "parse";
  id: string;
  input: ParsePipelineInput;
};

type WorkerResponse =
  | { id: string; result: ParsePipelineResult }
  | { id: string; error: string };

const config = workerData as { config: ParsePipelineWorkerConfig };
const workerConfig: ParsePipelineWorkerConfig = {
  ...config.config,
  placeScanEntries: config.config.placeScanEntries ?? GF_P6_SCAN_ENTRIES,
  placeScanRevision: config.config.placeScanRevision ?? "worker-fixture",
};
const pipeline = createParsePipelineInWorker(workerConfig);

parentPort?.on("message", (msg: WorkerRequest) => {
  if (msg.type !== "parse") return;

  void pipeline
    .execute(msg.input)
    .then((result) => {
      const response: WorkerResponse = { id: msg.id, result };
      parentPort?.postMessage(response);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const response: WorkerResponse = { id: msg.id, error: message };
      parentPort?.postMessage(response);
    });
});
