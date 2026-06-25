import { useMemo } from "react";
import { Panel } from "../../shared/ds";
import { LEVEL_COLORS, LEVEL_LABELS } from "../../shared/config/mapConfig.service";
import { useBehaviorSubject } from "../../shared/hooks/useBehaviorSubject";
import { regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion } from "../../shared/state/selectionStore";
import { topActivity$ } from "../../shared/state/topActivityStore";
import type { WidgetProps } from "../widgetProps";

const BAR_MAX_PX = 48;

/** Топ-10 регионов по количеству danger-событий за последние 7 дней. */
export function TopActivityWidget({
  defaultCollapsed = false,
  panelPersistenceKey,
}: WidgetProps) {
  const top = useBehaviorSubject(topActivity$);
  const regions = useBehaviorSubject(regionsByCode$);

  const maxCount = useMemo(
    () => Math.max(1, ...top.map((r) => r.eventCount)),
    [top],
  );

  return (
    <Panel
      title="Топ активности (7д)"
      variant="glass"
      collapsible
      defaultCollapsed={defaultCollapsed}
      persistenceKey={panelPersistenceKey}
    >
      {top.length === 0 ? (
        <p className="ds-muted">Нет данных.</p>
      ) : (
        <ul className="ds-trend-list">
          {top.map((row, idx) => {
            const region = regions.get(row.regionCode);
            const level = region?.stateLevel ?? "grey";
            const levelLabel = LEVEL_LABELS[level];
            const dotTitle = `Сейчас: ${levelLabel}`;
            const barWidth = Math.max(2, Math.round((row.eventCount / maxCount) * BAR_MAX_PX));

            return (
              <li
                key={row.regionCode}
                className="ds-trend-list__item"
                onClick={() => selectRegion(row.regionCode)}
                onKeyDown={(e) => { if (e.key === "Enter") selectRegion(row.regionCode); }}
                role="button"
                tabIndex={0}
              >
                <span className="ds-trend-list__rank">{idx + 1}</span>

                {/* Кружок — текущий live-статус региона */}
                <span
                  className="ds-trend-list__dot"
                  style={{ background: LEVEL_COLORS[level] }}
                  title={dotTitle}
                />

                <span className="ds-trend-list__code">{row.regionCode.replace("RU-", "")}</span>
                <span className="ds-trend-list__name" title={row.name}>
                  {row.name}
                </span>
                <span className="ds-trend-list__activity" title={`${row.eventCount} событий за 7д`}>
                  {row.eventCount}
                </span>

                {/* Полоска прижата к правому краю — всегда на одной оси */}
                <span className="ds-trend-list__bar-track">
                  <span
                    className="ds-trend-list__bar"
                    style={{ width: `${barWidth}px` }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
