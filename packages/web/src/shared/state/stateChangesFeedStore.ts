import { BehaviorSubject } from "rxjs";
import { stateChangeEventsResponseSchema } from "@radar/shared";
import type { StateChangeEventItem } from "@radar/shared";
import { mapApi } from "../api/mapApi";
import { startIntervalPoll } from "../rx/startIntervalPoll";
import { reportAppError } from "./appLogStore";

/** parsed_event + mat_parse_location (GET /api/map/events/recent). */
export const stateChangesFeed$ = new BehaviorSubject<StateChangeEventItem[]>([]);

const POLL_MS = 15_000;
let started = false;

export function startStateChangesFeedStore(): void {
  if (started) return;
  started = true;

  startIntervalPoll(POLL_MS, refreshStateChangesFeed);
}

async function refreshStateChangesFeed(): Promise<void> {
  try {
    const data = await mapApi.recentStateChangeEvents();
    stateChangesFeed$.next(stateChangeEventsResponseSchema.parse(data).items);
  } catch (error) {
    reportAppError("Лента изменений", error);
  }
}
