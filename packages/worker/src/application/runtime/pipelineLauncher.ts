/**
 * ---
 * layer: worker/runtime
 * domain: deployment
 * purpose: Контракт унифицированного launcher pipeline для composition root / admin discovery.
 * ---
 */
import type { ObsPipelineRuntime, PipelineKey } from "@radar/shared";

/** Унифицированный launcher для ODP / admin discovery. */
export interface PipelineLauncher {
  readonly pipelineKey: PipelineKey;
  readonly runtime: ObsPipelineRuntime;
  start(): void;
  stop(): void | Promise<void>;
  /** Runner-platform workloads — bus trigger wake. */
  enqueue?(): void;
}
