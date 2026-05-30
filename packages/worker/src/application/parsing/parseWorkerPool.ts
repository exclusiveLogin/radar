import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { ParsePipelineInput, ParsePipelineResult } from "./parsePipelineService.js";
import type { ParsePipelineWorkerConfig } from "./createParsePipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Worker thread грузит скомпилированный .js (Node без tsx).
 * tsx/--import в worker_threads на Windows не резолвит импорты `.js` → `.ts`.
 */
function resolveParseWorkerEntry(): URL {
  const distJs = path.resolve(here, "../../../dist/application/parsing/parsePipeline.worker.js");
  if (!fs.existsSync(distJs)) {
    throw new Error(
      "Нет dist/application/parsing/parsePipeline.worker.js — выполните: npm run build -w @radar/worker",
    );
  }
  return pathToFileURL(distJs);
}

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
    const execArgv = process.execArgv.filter((arg) => !arg.startsWith("--inspect"));
    return new Worker(resolveParseWorkerEntry(), {
      workerData: { config: this.workerConfig },
      execArgv,
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
