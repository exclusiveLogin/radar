import { useMemo } from "react";
import { Accordion, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { formatDateTime } from "../../shared/format/dateTime";
import { useObservable } from "../../shared/hooks/useObservable";
import { pvoReports$ } from "../../shared/state/pvoReportsStore";
import type { PvoReportItem } from "../../shared/api/mapApi";
import type { WidgetProps } from "../widgetProps";

/** Суммарная строка для свёрнутого заголовка аккордеона. */
function buildSummaryLine(item: PvoReportItem): string {
  const { stats } = item;
  if (!stats) return "—";

  const parts: string[] = [];
  if (stats.totals.drones   !== undefined) parts.push(`${stats.totals.drones} БПЛА`);
  if (stats.totals.rockets  !== undefined) parts.push(`${stats.totals.rockets} ракет`);
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
    <div style={{ marginTop: 6 }}>
      {byRegion.map((r) => {
        const parts: string[] = [];
        if (r.drones   !== undefined) parts.push(`${r.drones} БПЛА`);
        if (r.rockets  !== undefined) parts.push(`${r.rockets} ракет`);
        if (r.balloons !== undefined) parts.push(`${r.balloons} МВШ`);
        return (
          <div key={r.code} className="ds-muted" style={{ fontSize: 11 }}>
            {r.name}: {parts.join(" · ")}
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
        const summary    = buildSummaryLine(report);
        const regionsLine = buildRegionsLine(report);
        const period     = report.stats?.period;
        const source     = report.channelTitle?.trim() || report.channelKey;

        return {
          id: report.id,
          headTip: [source, formatDateTime(report.postedAt), period, report.rawText.trim()]
            .filter(Boolean)
            .join("\n"),
          head: (
            <>
              <span className="ds-muted" style={{ fontSize: 11, marginRight: 6 }}>
                {formatDateTime(report.postedAt)}
              </span>
              <span style={{ fontWeight: 500 }}>
                {summary !== "—" ? `сбито ${summary}` : "—"}
              </span>
              {regionsLine && (
                <span className="ds-muted" style={{ fontSize: 11, marginLeft: 6 }}>
                  {regionsLine}
                </span>
              )}
            </>
          ),
          body: (
            <>
              <div className="ds-muted" style={{ fontSize: 11 }}>
                {source} · {formatDateTime(report.postedAt)}
              </div>
              <ByRegionList item={report} />
              <pre
                style={{
                  margin: "8px 0 0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                  fontSize: 12,
                  color: "var(--text)",
                }}
              >
                {report.rawText.trim()}
              </pre>
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
