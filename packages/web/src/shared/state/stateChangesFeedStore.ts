import { BehaviorSubject } from "rxjs";
import { stateChangeEventsResponseSchema } from "@radar/shared";
import type { StateChangeEventItem } from "@radar/shared";
import { mapApi } from "../api/mapApi";

/** Лента разобранных событий с привязкой к регионам (REST poll). */
export const stateChangesFeed$ = new BehaviorSubject<StateChangeEventItem[]>([]);

const POLL_MS = 15_000;
let started = false;

/** GET /api/map/events/recent */
export function startStateChangesFeedStore(): void {
  if (started) return;
  started = true;

  void refreshStateChangesFeed();
  setInterval(() => void refreshStateChangesFeed(), POLL_MS);
}

async function refreshStateChangesFeed(): Promise<void> {
  try {
    const data = await mapApi.recentStateChangeEvents();
    stateChangesFeed$.next(stateChangeEventsResponseSchema.parse(data).items);
  } catch (error) {
    console.error("[stateChangesFeedStore]", error);
  }
}
