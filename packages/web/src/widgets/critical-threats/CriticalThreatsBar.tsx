import { useMemo } from "react";
import { isCriticalTopBarThreat, isWithinCriticalWindow } from "@radar/shared";
import { ThreatIcon } from "../../shared/ds/ThreatIcon";
import { formatTimeShort } from "../../shared/format/dateTime";
import { useBehaviorSubject } from "../../shared/hooks/useBehaviorSubject";
import { isRegionVisibleOnMap } from "../../shared/state/derivations";
import {
  derivedRegionCodes$,
  mapViewAnchor$,
  regionsByCode$,
} from "../../shared/state/mapStore";
import { selectRegion } from "../../shared/state/selectionStore";
import { statusTitle } from "../../shared/state/statusDictionaryStore";

/**
 * Верхняя панель критических угроз: rocket_threat или warning+mass в окне 3ч.
 * Не дублирует ActiveThreatsWidget (правый рейл).
 */
export function CriticalThreatsBar() {
  const regions = useBehaviorSubject(regionsByCode$);
  const derived = useBehaviorSubject(derivedRegionCodes$);
  const now = useBehaviorSubject(mapViewAnchor$);

  const items = useMemo(
    () =>
      [...regions.values()]
        .filter((row) => !derived.has(row.regionCode))
        .filter((row) => isRegionVisibleOnMap(row, now))
        .filter((row) =>
          isCriticalTopBarThreat({ statusCode: row.statusCode, traits: row.traits }),
        )
        .filter((row) => isWithinCriticalWindow(row.statusEventAt, now))
        .sort((a, b) => (b.statusEventAt ?? "").localeCompare(a.statusEventAt ?? "")),
    [regions, derived, now],
  );

  if (items.length === 0) return null;

  return (
    <div className="critical-threats-bar" role="status" aria-live="polite">
      {items.map((row) => (
        <button
          key={row.regionCode}
          type="button"
          className="critical-threats-bar__chip"
          title={`${row.name} · ${statusTitle(row.statusCode)}`}
          onClick={() => selectRegion(row.regionCode)}
        >
          <ThreatIcon
            compact
            statusCode={row.statusCode}
            traits={row.traits}
            eventSubject={row.eventSubject}
            title={statusTitle(row.statusCode)}
          />
          <span className="critical-threats-bar__name">{row.name}</span>
          <span className="critical-threats-bar__code ds-muted">{row.regionCode}</span>
          <span className="critical-threats-bar__time">{formatTimeShort(row.statusEventAt)}</span>
        </button>
      ))}
    </div>
  );
}
