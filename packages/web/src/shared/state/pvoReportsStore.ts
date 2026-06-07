import { BehaviorSubject } from "rxjs";
import { mapApi, type PvoReportItem } from "../api/mapApi";

/** Информационная лента сводок ПВО (REST poll, не влияет на карту). */
export const pvoReports$ = new BehaviorSubject<PvoReportItem[]>([]);

const POLL_MS = 60_000;
let started = false;

export function startPvoReportsStore(): void {
  if (started) return;
  started = true;

  void refreshPvoReports();
  setInterval(() => void refreshPvoReports(), POLL_MS);
}

async function refreshPvoReports(): Promise<void> {
  try {
    const data = await mapApi.pvoReports(50);
    pvoReports$.next(data.items);
  } catch (error) {
    console.error("[pvoReportsStore]", error);
  }
}
