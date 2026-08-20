/**
 * Реестр geoParse-workload на runner-platform — по одной на каждую enabled geoParse-фазу.
 */
import type { PlaceEnrichmentRunner } from "../placeEnrichmentRunner.js";
import type { PhaseKindRunnerRegistryDeps } from "../../runtime/runner-platform/phaseKindRunnerRegistry.js";
import { PhaseKindRunnerRegistry } from "../../runtime/runner-platform/phaseKindRunnerRegistry.js";

export type GeoRunnerRegistryDeps = PhaseKindRunnerRegistryDeps & {
  placeEnrichmentRunner: PlaceEnrichmentRunner;
};

export class GeoRunnerRegistry {
  private readonly inner: PhaseKindRunnerRegistry;

  constructor(deps: GeoRunnerRegistryDeps) {
    this.inner = new PhaseKindRunnerRegistry(deps, "geoParse");
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
}
