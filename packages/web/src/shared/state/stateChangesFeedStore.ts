import { BehaviorSubject, map, shareReplay } from "rxjs";
import { stateChangeEventsResponseSchema } from "@radar/shared";
import type { StateChangeEventItem } from "@radar/shared";
import { mapApi } from "../api/mapApi";
import { startIntervalPoll } from "../rx/startIntervalPoll";
import { reportAppError } from "./appLogStore";
import { deriveMessagesFromStateChanges } from "./deriveMessagesFromStateChanges";

/** SSOT: разобранные события с привязкой к регионам (GET /api/map/events/recent). */
export const stateChangesFeed$ = new BehaviorSubject<StateChangeEventItem[]>([]);

/** Проекция того же потока: 1 карточка на raw_message. */
export const messagesFeed$ = stateChangesFeed$.pipe(
  map(deriveMessagesFromStateChanges),
  shareReplay({ bufferSize: 1, refCount: true }),
);

const POLL_MS = 15_000;
let started = false;

/** Единый poll ленты событий; «Сообщения» и «Лента изменений» читают один поток. */
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
