import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { ParsePipelineInput, ParsePipelineResult } from "./parsePipelineService.js";
import type { ParsePipelineWorkerConfig } from "./createParsePipeline.js";

type WorkerRequest = {
  type: "parse";
  id: string;
  input: ParsePipelineInput;
};

type WorkerResponse =
  | { id: string; result: ParsePipelineResult }
  | { id: string; error: string };

/**
 * Пул worker_threads для CPU/IO-тяжёлого classify + geo pipeline без блокировки event loop.
 */
export class ParseWorkerPool {
  private readonly workers: Worker[] = [];
  private roundRobin = 0;

  constructor(
    private readonly workerConfig: ParsePipelineWorkerConfig,
    poolSize = Number(process.env.RADAR_PARSE_WORKER_POOL_SIZE ?? "2"),
  ) {
    const size = Math.max(1, Math.min(poolSize, 8));
    for (let i = 0; i < size; i += 1) {
      this.workers.push(this.spawnWorker());
    }
  }

  private spawnWorker(): Worker {
    return new Worker(new URL("./parsePipeline.worker.ts", import.meta.url), {
      workerData: { config: this.workerConfig },
      execArgv: process.execArgv.filter((arg) => !arg.startsWith("--inspect")),
    });
  }

  async execute(input: ParsePipelineInput): Promise<ParsePipelineResult> {
    const worker = this.workers[this.roundRobin % this.workers.length];
    this.roundRobin += 1;
    const id = randomUUID();

    return new Promise((resolve, reject) => {
      const onMessage = (msg: WorkerResponse) => {
        if (msg.id !== id) return;
        worker.off("message", onMessage);
        worker.off("error", onError);
        if ("error" in msg) {
          reject(new Error(msg.error));
          return;
        }
        resolve(msg.result);
      };

      const onError = (err: Error) => {
        worker.off("message", onMessage);
        worker.off("error", onError);
        reject(err);
      };

      worker.on("message", onMessage);
      worker.on("error", onError);

      const request: WorkerRequest = { type: "parse", id, input };
      worker.postMessage(request);
    });
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers.length = 0;
  }
}

/** Включён ли пул потоков (по умолчанию — да в db mode). */
export function isParseWorkerPoolEnabled(): boolean {
  const flag = process.env.RADAR_PARSE_USE_WORKER_THREADS?.trim();
  if (flag === "0" || flag === "false") return false;
  return true;
}
