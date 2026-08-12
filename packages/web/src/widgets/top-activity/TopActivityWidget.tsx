import { useMemo } from "react";
import { Accordion, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { LEVEL_COLORS, LEVEL_LABELS } from "../../shared/config/mapConfig.service";
import { useBehaviorSubject } from "../../shared/hooks/useBehaviorSubject";
import { regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion } from "../../shared/state/selectionStore";
import { topActivity$ } from "../../shared/state/topActivityStore";
import type { WidgetProps } from "../widgetProps";

const BAR_MAX_PX = 56;

/** Топ-10 регионов по danger-событиям за 7д: одна строка + раскрытие. */
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

  const items: AccordionItem[] = useMemo(
    () =>
      top.map((row, idx) => {
        const region = regions.get(row.regionCode);
        const level = region?.stateLevel ?? "grey";
        const barWidth = Math.max(2, Math.round((row.eventCount / maxCount) * BAR_MAX_PX));
        const shortCode = row.regionCode.replace("RU-", "");

        return {
          id: row.regionCode,
          headTip: `${row.name}\n${row.regionCode}\n${row.eventCount} событий за 7д`,
          head: (
            <div className="ds-top-activity__row">
              <span
                className="ds-top-activity__accent"
                style={{ background: LEVEL_COLORS[level], color: LEVEL_COLORS[level] }}
                title={`Сейчас: ${LEVEL_LABELS[level]}`}
                aria-label={`Статус: ${LEVEL_LABELS[level]}`}
              />
              <span className="ds-top-activity__rank">#{idx + 1}</span>
              <span className="ds-top-activity__name" title={row.name}>
                {row.name}
              </span>
              <span className="ds-top-activity__count" title={`${row.eventCount} событий`}>
                {row.eventCount}
              </span>
              <span className="ds-top-activity__bar-track" aria-hidden>
                <span className="ds-top-activity__bar" style={{ width: `${barWidth}px` }} />
              </span>
              <span className="ds-top-activity__code">{shortCode}</span>
            </div>
          ),
          body: (
            <>
              <dl className="ds-event-card__facts">
                <div className="ds-event-card__fact">
                  <dt>Регион</dt>
                  <dd>
                    {row.name} · {row.regionCode}
                  </dd>
                </div>
                <div className="ds-event-card__fact">
                  <dt>События</dt>
                  <dd>{row.eventCount} за 7 дней</dd>
                </div>
                <div className="ds-event-card__fact">
                  <dt>Сейчас</dt>
                  <dd>{LEVEL_LABELS[level]}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="ds-event-card__action"
                onClick={() => selectRegion(row.regionCode)}
              >
                Контур на карте
              </button>
            </>
          ),
        };
      }),
    [top, regions, maxCount],
  );

  return (
    <Panel
      title="Топ активности (7д)"
      variant="glass"
      collapsible
      defaultCollapsed={defaultCollapsed}
      persistenceKey={panelPersistenceKey}
    >
      {items.length === 0 ? (
        <p className="ds-muted">Нет данных.</p>
      ) : (
        <Accordion items={items} />
      )}
    </Panel>
  );
}
