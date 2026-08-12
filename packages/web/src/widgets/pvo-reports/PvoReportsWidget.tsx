import { useMemo } from "react";
import { Accordion, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { EventCardHead } from "../../shared/components/EventCardHead";
import { formatDateTime, formatTimeShort } from "../../shared/format/dateTime";
import { useObservable } from "../../shared/hooks/useObservable";
import { pvoReports$ } from "../../shared/state/pvoReportsStore";
import type { PvoReportItem } from "../../shared/api/mapApi";
import type { WidgetProps } from "../widgetProps";

/** Суммарная строка для свёрнутого заголовка аккордеона. */
function buildSummaryLine(item: PvoReportItem): string {
  const { stats } = item;
  if (!stats) return "—";

  const parts: string[] = [];
  if (stats.totals.drones !== undefined) parts.push(`${stats.totals.drones} БПЛА`);
  if (stats.totals.rockets !== undefined) parts.push(`${stats.totals.rockets} ракет`);
  if (stats.totals.balloons !== undefined) parts.push(`${stats.totals.balloons} МВШ`);

  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Список регионов для отображения в строке. */
function buildRegionsLine(item: PvoReportItem): string {
  const regions = item.stats?.regions ?? [];
  if (regions.length === 0) return "";
  return regions.map((r) => r.name).join(", ");
}

/** Разбивка по регионам (шаблон Б). */
function ByRegionList({ item }: { item: PvoReportItem }) {
  const byRegion = item.stats?.byRegion;
  if (!byRegion || byRegion.length === 0) return null;

  return (
    <div className="ds-event-card__facts" style={{ marginTop: 6 }}>
      {byRegion.map((r) => {
        const parts: string[] = [];
        if (r.drones !== undefined) parts.push(`${r.drones} БПЛА`);
        if (r.rockets !== undefined) parts.push(`${r.rockets} ракет`);
        if (r.balloons !== undefined) parts.push(`${r.balloons} МВШ`);
        return (
          <div key={r.code} className="ds-event-card__fact">
            <dt>{r.name}</dt>
            <dd>{parts.join(" · ") || "—"}</dd>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Виджет сводок ПВО — информационная лента без влияния на карту.
 * Отображает сводные отчёты за периоды с разбивкой по БПЛА / ракетам / МВШ.
 */
export function PvoReportsWidget({
  defaultCollapsed = true,
  panelPersistenceKey,
}: WidgetProps) {
  const reports = useObservable(pvoReports$, []);

  const items: AccordionItem[] = useMemo(
    () =>
      reports.map((report) => {
        const summary = buildSummaryLine(report);
        const regionsLine = buildRegionsLine(report);
        const period = report.stats?.period;
        const source = report.channelTitle?.trim() || report.channelKey;
        const title = summary !== "—" ? `сбито ${summary}` : "Сводка ПВО";
        const raw = report.rawText.trim();

        return {
          id: report.id,
          headTip: [source, formatDateTime(report.postedAt), period, raw]
            .filter(Boolean)
            .join("\n"),
          head: (
            <EventCardHead
              title={title}
              reason={regionsLine || undefined}
              time={formatTimeShort(report.postedAt)}
              meta={
                <>
                  <span className="ds-event-card__meta-source">{source}</span>
                  {period && <span className="ds-event-card__meta-code">{period}</span>}
                </>
              }
            />
          ),
          body: (
            <>
              <dl className="ds-event-card__facts">
                <div className="ds-event-card__fact">
                  <dt>Источник</dt>
                  <dd>{source}</dd>
                </div>
                <div className="ds-event-card__fact">
                  <dt>Время</dt>
                  <dd>{formatDateTime(report.postedAt)}</dd>
                </div>
                {period && (
                  <div className="ds-event-card__fact">
                    <dt>Период</dt>
                    <dd>{period}</dd>
                  </div>
                )}
                {regionsLine && (
                  <div className="ds-event-card__fact">
                    <dt>Регионы</dt>
                    <dd>{regionsLine}</dd>
                  </div>
                )}
              </dl>
              <ByRegionList item={report} />
              {raw && <pre className="ds-event-card__quote">{raw}</pre>}
            </>
          ),
        };
      }),
    [reports],
  );

  return (
    <Panel
      title="Сводки ПВО"
      variant="glass"
      collapsible
      defaultCollapsed={defaultCollapsed}
      persistenceKey={panelPersistenceKey}
    >
      {items.length === 0 ? (
        <p className="ds-muted">Нет сводок ПВО.</p>
      ) : (
        <Accordion items={items} />
      )}
    </Panel>
  );
}
