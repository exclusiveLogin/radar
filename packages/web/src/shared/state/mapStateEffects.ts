import { from, of } from "rxjs";
import { catchError, distinctUntilChanged, finalize, switchMap, tap } from "rxjs/operators";
import { mapApi } from "../api/mapApi";
import { pushAppLog, reportAppError } from "./appLogStore";
import { clearAllGeoGeometry } from "./geoGeometryStore";
import { applyMapSnapshot, historicalAsOf$, mapHistoricalLoading$ } from "./mapStore";

let effectsStarted = false;

/** REST bootstrap / replay: regions + places для asOf (null = live). */
async function loadMapSnapshot(asOf: string | null): Promise<void> {
  const [regionsResp, placesResp] = asOf
    ? await Promise.all([
        mapApi.regionsState({ asOf }),
        mapApi.placesState({ asOf }),
      ])
    : await Promise.all([mapApi.regionsState(), mapApi.placesState()]);

  applyMapSnapshot(regionsResp.regions, placesResp.places, regionsResp.generatedAt);
}

/**
 * Реактивная загрузка fold-state при scrub таймлайна.
 * switchMap отменяет устаревшие запросы при быстром перемещении ползунка.
 */
export function startMapStateEffects(): void {
  if (effectsStarted) return;
  effectsStarted = true;

  historicalAsOf$.pipe(
    distinctUntilChanged(),
    tap((asOf) => {
      mapHistoricalLoading$.next(true);
      clearAllGeoGeometry();
      pushAppLog(
        "info",
        asOf ? `Срез asOf=${asOf}` : "Переход в live",
        { source: "Карта" },
      );
    }),
    switchMap((asOf) =>
      from(loadMapSnapshot(asOf)).pipe(
        tap(() => {
          pushAppLog(
            "info",
            asOf ? "Срез fold загружен" : "Live fold обновлён",
            { source: "Карта" },
          );
        }),
        catchError((error) => {
          reportAppError("Карта", error, "Ошибка загрузки fold-state");
          return of(undefined);
        }),
        finalize(() => mapHistoricalLoading$.next(false)),
      ),
    ),
  ).subscribe();
}
