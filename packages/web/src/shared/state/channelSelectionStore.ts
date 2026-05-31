import { BehaviorSubject } from "rxjs";

/**
 * Выбранный канал (по channelKey) — общий контекст между админ-панелями.
 * Выбор в ChannelPicker формирует контекст для статистики/раннера backfill.
 */
export const selectedChannelKey$ = new BehaviorSubject<string | null>(null);

export function selectChannel(channelKey: string | null): void {
  selectedChannelKey$.next(channelKey);
}
