import { useEffect, useState } from "react";
import type { StateChangeEventItem } from "@radar/shared";
import { LEVEL_COLORS, LEVEL_LABELS } from "../../shared/config/mapConfig.service";
import { mapApi } from "../../shared/api/mapApi";
import { reportAppError } from "../../shared/state/appLogStore";
import { formatDateTime } from "../../shared/format/dateTime";
import { derivedRegionCodes$, regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import { EventTraitIcons } from "../../shared/components/EventTraitIcons";

/** Панель с деталями выбранного региона: статус, источник, история событий. */
export function RegionDetailWidget() {
  const [code, setCode] = useState(() => selectedRegion$.getValue());
  const [regions, setRegions] = useState(() => regionsByCode$.getValue());
  const [derivedCodes, setDerivedCodes] = useState(() => derivedRegionCodes$.getValue());
  const [events, setEvents] = useState<StateChangeEventItem[]>([]);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sub = selectedRegion$.subscribe(setCode);
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const sub = regionsByCode$.subscribe(setRegions);
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const sub = derivedRegionCodes$.subscribe(setDerivedCodes);
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (!code) {
      setEvents([]);
      setSourceText(null);
      setExpanded(false);
      return;
    }
    setLoading(true);
    Promise.all([
      mapApi.regionEvents(code, 30),
      mapApi.regionSourceMessage(code),
    ])
      .then(([eventsResp, sourceResp]) => {
        setEvents(eventsResp.items);
        setSourceText(sourceResp.message?.rawText ?? null);
      })
      .catch((error) => reportAppError("Регион", error))
      .finally(() => setLoading(false));
  }, [code]);

  if (!code) return null;

  const region = regions.get(code);
  const isDerived = derivedCodes.has(code);
  const levelColor = region ? LEVEL_COLORS[region.stateLevel] : "#384050";
  const levelLabel = region
    ? isDerived
      ? `${LEVEL_LABELS[region.stateLevel]} (производный)`
      : LEVEL_LABELS[region.stateLevel]
    : "—";

  return (
    <div className="region-detail-panel" role="complementary" aria-label="Детали региона">
      <div className="region-detail-panel__header">
        <div className="region-detail-panel__title">
          <span className="region-detail-panel__code">{code}</span>
          <span className="region-detail-panel__name">{region?.name ?? code}</span>
        </div>
        <button
          type="button"
          className="region-detail-panel__close"
          onClick={() => selectRegion(null)}
          aria-label="Закрыть"
        >
          ×
        </button>
      </div>

      <div className="region-detail-panel__status">
        <span
          className="region-detail-panel__level-dot"
          style={{ background: levelColor }}
        />
        <span className="region-detail-panel__level-label">{levelLabel}</span>
        {region?.activity ? (
          <span className="region-detail-panel__activity">×{region.activity}</span>
        ) : null}
        {region?.statusEventAt ? (
          <span className="region-detail-panel__since">
            с {formatDateTime(region.statusEventAt)}
          </span>
        ) : null}
      </div>

      {sourceText ? (
        <div className="region-detail-panel__source">
          <button
            type="button"
            className="region-detail-panel__source-toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "▾" : "▸"} Исходное сообщение
          </button>
          {expanded ? (
            <pre className="region-detail-panel__source-text">{sourceText}</pre>
          ) : null}
        </div>
      ) : null}

      <div className="region-detail-panel__history">
        <div className="region-detail-panel__history-title">История событий</div>
        {loading ? (
          <div className="ds-muted">Загрузка…</div>
        ) : events.length === 0 ? (
          <div className="ds-muted">Нет данных</div>
        ) : (
          <ul className="region-detail-panel__history-list">
            {events.map((evt) => (
              <li key={evt.parsedEventId} className="region-detail-panel__history-item">
                <span
                  className="region-detail-panel__history-dot"
                  style={{ background: LEVEL_COLORS[evt.stateLevel] }}
                />
                <span className="region-detail-panel__history-time">
                  {formatDateTime(evt.postedAt)}
                </span>
                <span className="region-detail-panel__history-type">{evt.eventType}</span>
                <EventTraitIcons
                  compact
                  repeat={evt.repeat}
                  uncertain={evt.uncertain}
                  multiple={evt.multiple}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
