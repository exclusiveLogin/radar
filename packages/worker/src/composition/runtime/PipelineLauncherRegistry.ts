/**
 * ---
 * layer: worker/composition
 * domain: deployment/runtime
 * purpose: Хранит запущенные launcher и даёт единый порт для их wake.
 * ---
 */
import type { PipelineKey } from "@radar/shared";
import type { PipelineLauncher } from "../../application/runtime/pipelineLauncher.js";

/** Узкий порт для источников сигналов, которым нужен только wake pipeline. */
export interface PipelineWakePort {
  wake(pipelineKey: PipelineKey): void;
}

/** Реестр launcher текущего worker runtime. */
export class PipelineLauncherRegistry implements PipelineWakePort {
  private readonly registeredLaunchers: PipelineLauncher[] = [];

  get launchers(): readonly PipelineLauncher[] {
    return this.registeredLaunchers;
  }

  register(launcher: PipelineLauncher): void {
    this.registeredLaunchers.push(launcher);
  }

  wake(pipelineKey: PipelineKey): void {
    this.findWakeable(pipelineKey)?.enqueue?.();
  }

  hasWakeable(pipelineKey: PipelineKey): boolean {
    return this.findWakeable(pipelineKey) != null;
  }

  private findWakeable(pipelineKey: PipelineKey): PipelineLauncher | undefined {
    return this.registeredLaunchers.find(
      (launcher) => launcher.pipelineKey === pipelineKey && launcher.enqueue != null,
    );
  }
}
