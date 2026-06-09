/**
 * Порты отчёта о ходе geo-sync (application layer).
 * Не зависят от cli-progress — адаптеры живут в scripts/geo-sync.
 */
import type { GeoProviderSnapshot } from "@radar/shared";

/** Единый progress-bar batch-persist: regions + places + aliases. */
export interface IGeoSyncPersistReporter {
  begin(total: number): void;
  tick(delta: number): void;
  extendTotal(extra: number): void;
  finish(): void;
}

/** События загрузки snapshot (отдельный короткий бар в CLI). */
export interface IGeoSyncSnapshotReporter {
  snapshotLoaded(): void;
}

export type GeoSyncApplyRunOptions = {
  persist?: IGeoSyncPersistReporter;
  snapshot?: IGeoSyncSnapshotReporter;
};

export type GeoSyncPlanRunOptions = {
  skipSnapshot?: boolean;
  snapshot?: GeoProviderSnapshot;
  snapshotReporter?: IGeoSyncSnapshotReporter;
};
