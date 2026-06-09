import { createProgress, type ProgressHandle } from "@radar/shared";
import type {
  IGeoSyncPersistReporter,
  IGeoSyncSnapshotReporter,
} from "../../application/geo-sync/geo-sync.reporter.port";

/** CLI-адаптер: один бар на regions + places + aliases. */
export function createGeoSyncPersistReporter(): IGeoSyncPersistReporter {
  let bar: ProgressHandle | null = null;
  let total = 0;

  return {
    begin(initialTotal) {
      total = initialTotal;
      bar?.stop();
      bar = createProgress("geo:db:apply", total);
    },
    tick(delta) {
      bar?.tick(delta);
    },
    extendTotal(extra) {
      if (extra <= 0) return;
      total += extra;
      bar?.setTotal(total);
    },
    finish() {
      bar?.stop();
      bar = null;
    },
  };
}

/** CLI-адаптер: короткий бар загрузки snapshot. */
export function createGeoSyncSnapshotReporter(label: string): {
  reporter: IGeoSyncSnapshotReporter;
  stop(): void;
} {
  const bar = createProgress(label, 1);
  return {
    reporter: {
      snapshotLoaded() {
        bar.tick(1);
      },
    },
    stop() {
      bar.stop();
    },
  };
}
