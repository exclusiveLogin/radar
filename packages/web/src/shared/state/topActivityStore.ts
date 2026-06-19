import { BehaviorSubject } from "rxjs";
import { mapApi } from "../api/mapApi";
import type { TopActivityRow } from "../api/mapApi";
import { startIntervalPoll } from "../rx/startIntervalPoll";
import { reportAppError } from "./appLogStore";

/** Топ регионов по danger-событиям за 7 дней. */
export const topActivity$ = new BehaviorSubject<TopActivityRow[]>([]);

const POLL_MS = 60_000;
let started = false;

export function startTopActivityStore(): void {
  if (started) return;
  started = true;

  startIntervalPoll(POLL_MS, refresh);
}

async function refresh(): Promise<void> {
  try {
    const { items } = await mapApi.topActivity(10);
    topActivity$.next(items);
  } catch (error) {
    reportAppError("Топ активности", error);
  }
}
