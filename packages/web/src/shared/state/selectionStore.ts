import { BehaviorSubject } from "rxjs";

/**
 * Выбранный регион (по regionCode) — общий канал связи между виджетами.
 * Клик на схеме/гео/предупреждении пишет сюда; все виджеты читают.
 */
export const selectedRegion$ = new BehaviorSubject<string | null>(null);

export function selectRegion(regionCode: string | null): void {
  selectedRegion$.next(regionCode);
}
