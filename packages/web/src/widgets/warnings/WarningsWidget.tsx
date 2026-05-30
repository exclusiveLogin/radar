import { useMemo } from "react";
import type { Warning } from "@radar/shared";
import { Accordion, Badge, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { warnings$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Лента предупреждений: аккордеон, фильтруется по выбранному региону. */
export function WarningsWidget() {
  const warnings = useObservable(warnings$, [] as Warning[]);
  const selected = useObservable(selectedRegion$, null);

  const visible = useMemo(
    () => (selected ? warnings.filter((w) => w.regionCode === selected) : warnings),
    [warnings, selected],
  );

  const items: AccordionItem[] = visible.map((warning) => ({
    id: warning.id,
    head: (
      <>
        <Badge level={warning.stateLevel ?? "grey"} />
        <span>{warning.regionCode ?? "—"}</span>
        <span className="ds-muted" style={{ marginLeft: "auto" }}>
          {formatTime(warning.eventAt)}
        </span>
      </>
    ),
    body: (
      <>
        <div>{warning.title}</div>
        {warning.text && <div className="ds-muted">{warning.text}</div>}
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
    <Panel title="Предупреждения" actions={filterAction}>
      {items.length === 0 ? (
        <p className="ds-muted">Нет предупреждений.</p>
      ) : (
        <Accordion items={items} />
      )}
    </Panel>
  );
}
