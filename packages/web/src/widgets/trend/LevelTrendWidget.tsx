import { useMemo } from "react";
import { BarMini, Panel, Sparkline } from "../../shared/ds";
import { LEVEL_COLORS, LEVEL_LABELS } from "../../shared/config/mapConfig.service";
import { useObservable } from "../../shared/hooks/useObservable";
import { warningsTimeBuckets } from "../../shared/state/derivations";
import { stateChanges$ } from "../../shared/state/mapStore";
import type { StateLevel } from "@radar/shared";

const TREND_LEVELS: StateLevel[] = ["red", "orange", "yellow", "green", "grey"];

/** Короткая подпись для BarMini — без коллизий green/grey (не slice(0,3) от enum). */
function levelBarLabel(level: StateLevel): string {
  const ru = LEVEL_LABELS[level];
  if (ru.length <= 4) return ru;
  return ru.slice(0, 3);
}

import type { WidgetProps } from "../widgetProps";

/** Sparkline событий по времени из warnings (окно до 200 записей). */
export function LevelTrendWidget({
  defaultCollapsed = false,
  panelPersistenceKey,
}: WidgetProps) {
  const changes = useObservable(stateChanges$, []);

  const buckets = useMemo(() => warningsTimeBuckets(changes, 24), [changes]);

  const levelBars = useMemo(() => {
    const counts: Partial<Record<StateLevel, number>> = {};
    for (const w of changes) {
      const level = (w.stateLevel ?? "grey") as StateLevel;
      counts[level] = (counts[level] ?? 0) + 1;
    }
    return TREND_LEVELS.filter((level) => (counts[level] ?? 0) > 0).map((level) => ({
      key: level,
      label: levelBarLabel(level),
      tip: LEVEL_LABELS[level],
      value: counts[level] ?? 0,
      color: LEVEL_COLORS[level],
    }));
  }, [changes]);

  return (
    <Panel
      title="Динамика событий"
      variant="glass"
      collapsible
      defaultCollapsed={defaultCollapsed}
      persistenceKey={panelPersistenceKey}
    >
      <p className="ds-muted" style={{ margin: "0 0 6px", fontSize: 11 }}>
        Окно: {changes.length} записей (макс. 200)
      </p>
      <Sparkline values={buckets} width={280} height={56} />
      {levelBars.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <BarMini bars={levelBars} width={280} height={56} />
        </div>
      )}
    </Panel>
  );
}
