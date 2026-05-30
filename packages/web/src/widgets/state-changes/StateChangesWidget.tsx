import { useMemo } from "react";
import type { Warning } from "@radar/shared";
import { Accordion, Badge, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { stateChanges$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

import type { WidgetProps } from "../widgetProps";

/** Лента смен состояния регионов (region_state_history + WS). */
export function StateChangesWidget({ defaultCollapsed = false }: WidgetProps) {
  const changes = useObservable(stateChanges$, [] as Warning[]);
  const selected = useObservable(selectedRegion$, null);

  const visible = useMemo(
    () => (selected ? changes.filter((row) => row.regionCode === selected) : changes),
    [changes, selected],
  );

  const items: AccordionItem[] = visible.map((row) => ({
    id: row.id,
    head: (
      <>
        <Badge level={row.stateLevel ?? "grey"} />
        <span>{row.regionCode ?? "—"}</span>
        <span className="ds-muted" style={{ marginLeft: "auto" }}>
          {formatTime(row.eventAt)}
        </span>
      </>
    ),
    body: (
      <>
        <div>{row.title}</div>
        {row.text && <div className="ds-muted">{row.text}</div>}
      </>
    ),
  }));

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
    <Panel title="Лента изменений" actions={filterAction} variant="glass" collapsible defaultCollapsed={defaultCollapsed}>
      {items.length === 0 ? (
        <p className="ds-muted">Нет записей в журнале.</p>
      ) : (
        <Accordion items={items} />
      )}
    </Panel>
  );
}
