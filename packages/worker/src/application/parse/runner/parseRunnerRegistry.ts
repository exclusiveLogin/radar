/**
 * Реестр parse-workload на runner-platform — по одной на каждую enabled ingestParse-фазу.
 */
import type { PhaseKindRunnerRegistryDeps } from "../../runtime/runner-platform/phaseKindRunnerRegistry.js";
import { PhaseKindRunnerRegistry } from "../../runtime/runner-platform/phaseKindRunnerRegistry.js";

export type ParseRunnerRegistryDeps = PhaseKindRunnerRegistryDeps;

export class ParseRunnerRegistry {
  private readonly inner: PhaseKindRunnerRegistry;

  constructor(deps: ParseRunnerRegistryDeps) {
    this.inner = new PhaseKindRunnerRegistry(deps, "ingestParse");
  }

  start(): void {
    this.inner.start();
  }

  stop(): Promise<void> {
    return this.inner.stop();
  }

  enqueueAll(): void {
    this.inner.enqueueAll();
  }

  /** Для тестов / ops refresh без ожидания interval. */
  refresh(): Promise<void> {
    return this.inner.refresh();
  }
}