import { useMemo } from "react";
import type { Warning } from "@radar/shared";
import { Accordion, Badge, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { SourceMessageBlock } from "../../shared/components/SourceMessageBlock";
import { formatDateTime, formatTimeShort } from "../../shared/format/dateTime";
import { useObservable } from "../../shared/hooks/useObservable";
import { stateChanges$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import type { WidgetProps } from "../widgetProps";
import {
  formatGroupedRegionsLabel,
  groupStateChanges,
} from "./groupStateChanges";

/** Лента смен состояния регионов (region_state_history + WS). */
export function StateChangesWidget({ defaultCollapsed = false }: WidgetProps) {
  const changes = useObservable(stateChanges$, [] as Warning[]);
  const selected = useObservable(selectedRegion$, null);

  const visible = useMemo(() => {
    const filtered = selected
      ? changes.filter(
          (row) =>
            row.regionCode === selected ||
            row.regionId === selected,
        )
      : changes;
    return groupStateChanges(filtered);
  }, [changes, selected]);

  const items: AccordionItem[] = visible.map((row) => {
    const headRegion = formatGroupedRegionsLabel(row.regions);
    const codesLine = row.regions
      .map((r) => r.regionCode)
      .filter((code): code is string => Boolean(code))
      .join(" · ");
    const sourceRegionCode = row.regions[0]?.regionCode;

    return {
      id: row.id,
      headTip: [headRegion, codesLine, row.title, row.text].filter(Boolean).join("\n"),
      head: (
        <>
          <Badge level={row.stateLevel ?? "grey"} />
          <span>{headRegion}</span>
          {codesLine && row.regions.length > 1 ? (
            <span className="ds-muted">{codesLine}</span>
          ) : row.regions.length === 1 && row.regions[0]?.regionCode ? (
            <span className="ds-muted">{row.regions[0].regionCode}</span>
          ) : null}
          <span className="ds-muted" style={{ marginLeft: "auto" }}>
            {formatTimeShort(row.eventAt)}
          </span>
        </>
      ),
      body: (
        <>
          <div>{row.title}</div>
          <div className="ds-muted" style={{ fontSize: 11 }}>
            Запись: {formatDateTime(row.eventAt)}
            {row.regions.length > 1 ? ` · ${row.regions.length} региона` : null}
          </div>
          {row.text && <div className="ds-muted">{row.text}</div>}
          {sourceRegionCode ? (
            <SourceMessageBlock regionCode={sourceRegionCode} />
          ) : null}
        </>
      ),
    };
  });

  const filterAction = selected ? (
    <button
      type="button"
      className="ds-accordion__head"
      style={{ width: "auto", padding: "2px 8px" }}
      onClick={() => selectRegion(null)}
    >
      Сбросить фильтр: {selected}
    </button>
  ) : null;

  return (
    <Panel
      title="Лента изменений"
      actions={filterAction}
      variant="glass"
      collapsible
      defaultCollapsed={defaultCollapsed}
    >
      {items.length === 0 ? (
        <p className="ds-muted">Нет записей в журнале.</p>
      ) : (
        <Accordion items={items} />
      )}
    </Panel>
  );
}
