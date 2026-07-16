/**
 * ---
 * layer: worker/application
 * domain: parse/runner
 * purpose: Р РµРµСЃС‚СЂ parse-workload'РѕРІ РЅР° runner platform вЂ” РїРѕ РѕРґРЅРѕРјСѓ РЅР° РєР°Р¶РґСѓСЋ enabled
 *          scheduled ingestParse-С„Р°Р·Сѓ. РџРµСЂРёРѕРґРёС‡РµСЃРєРё СЃРІРµСЂСЏРµС‚ СЃРїРёСЃРѕРє С„Р°Р· (Р°РґРјРёРЅРєР° РјРѕР¶РµС‚
 *          РІРєР»СЋС‡Р°С‚СЊ/РІС‹РєР»СЋС‡Р°С‚СЊ С„Р°Р·С‹ РІ СЂР°РЅС‚Р°Р№РјРµ) Рё СЃРѕР·РґР°С‘С‚/РѕСЃС‚Р°РЅР°РІР»РёРІР°РµС‚ workload РїРѕРґ РЅРёС….
 *          РђРЅР°Р»РѕРі `IngestParseDaemonService.refreshSchedules`, РЅРѕ РєР°Р¶РґР°СЏ С„Р°Р·Р° вЂ” СЃРІРѕР№ jobKernel
 *          РІРјРµСЃС‚Рѕ bespoke `Map<phaseId, setInterval>`.
 * ---
 */
import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
} from "@radar/shared";
import type { PlaceEnrichmentRunner } from "../../geo-parse/placeEnrichmentRunner.js";
import type { PhaseRunner } from "../../phases/phaseRunner.js";
import { createUnifiedPhaseWorkload } from "../../runner-platform/unifiedPhaseWorkload.js";
import type { WorkloadObsContext } from "../../runtime/observability/workloadObsHooks.js";
import { createWorkloadObsConfig } from "../../runtime/observability/workloadObsHooks.js";
import type { Workload } from "../../runtime/workload/createWorkload.js";

const DEFAULT_REFRESH_MS = 15_000;

export type ParseRunnerRegistryDeps = {
  phases: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
  coverage: IPhaseCoverageRepository;
  placeJobs: IPlaceEnrichmentJobRepository;
  runner: PhaseRunner;
  placeEnrichmentRunner?: PlaceEnrichmentRunner;
  obs?: WorkloadObsContext;
};

export class ParseRunnerRegistry {
  private workloads = new Map<string, Workload>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  constructor(private readonly deps: ParseRunnerRegistryDeps) {}

  start(): void {
    this.stopped = false;
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), DEFAULT_REFRESH_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    for (const workload of this.workloads.values()) workload.stop();
    this.workloads.clear();
  }

  /** Wave 6 (chaining): Р±СѓРґРёС‚ РІСЃРµ Р°РєС‚РёРІРЅС‹Рµ phase-workload'С‹ РІРЅРµ РёС… РёРЅС‚РµСЂРІР°Р»Р° (СЃРѕР±С‹С‚РёРµ РІРјРµСЃС‚Рѕ РѕР¶РёРґР°РЅРёСЏ). */
  enqueueAll(): void {
    for (const workload of this.workloads.values()) workload.enqueue();
  }

  private async refresh(): Promise<void> {
    if (this.stopped) return;
    const scheduled = await this.deps.phases.listEnabled(undefined, "ingestParse");
    const ids = new Set(scheduled.map((p) => p.id));

    for (const [id, workload] of this.workloads) {
      if (!ids.has(id)) {
        workload.stop();
        this.workloads.delete(id);
      }
    }

    for (const phase of scheduled) {
      if (this.workloads.has(phase.id)) continue;
      const phaseObs = this.deps.obs
        ? createWorkloadObsConfig({ ...this.deps.obs, workloadIdSuffix: phase.id })
        : undefined;
      const workload = createUnifiedPhaseWorkload(this.deps, phase, phaseObs);
      workload.start();
      this.workloads.set(phase.id, workload);
    }
  }
}
