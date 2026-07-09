import { BehaviorSubject } from "rxjs";
import { messageFeedResponseSchema, type MessageFeedItem } from "@radar/shared";
import { mapApi } from "../api/mapApi";
import { startIntervalPoll } from "../rx/startIntervalPoll";
import { reportAppError } from "./appLogStore";

/** Все mat_ingest_raw (GET /api/map/messages/recent). */
export const messagesFeed$ = new BehaviorSubject<MessageFeedItem[]>([]);

const POLL_MS = 20_000;
let started = false;

export function startMessagesStore(): void {
  if (started) return;
  started = true;

  startIntervalPoll(POLL_MS, refreshMessages);
}

async function refreshMessages(): Promise<void> {
  try {
    const data = await mapApi.recentMessages();
    messagesFeed$.next(messageFeedResponseSchema.parse(data).items);
  } catch (error) {
    reportAppError("Сообщения", error);
  }
}
