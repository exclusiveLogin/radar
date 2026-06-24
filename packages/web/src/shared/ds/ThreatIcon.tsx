import type { ResolveThreatVisualInput } from "@radar/shared";
import { resolveThreatVisual } from "@radar/shared";

export type ThreatIconProps = ResolveThreatVisualInput & {
  /** Компактный размер для чипов и тултипов. */
  compact?: boolean;
  /** Подпись при наведении (из словаря). */
  title?: string;
};

/** Иконка типа угрозы (ракета / БПЛА / ПВО) — SSOT через shared threat-visual. */
export function ThreatIcon({
  statusCode,
  traits,
  eventSubject,
  compact = false,
  title,
}: ThreatIconProps) {
  const visual = resolveThreatVisual({ statusCode, traits, eventSubject });
  if (!visual) return null;

  const rootClass = compact
    ? "ds-threat-icon ds-threat-icon--compact"
    : "ds-threat-icon";
  const modClass = `ds-threat-icon--${visual.key}`;

  return (
    <span
      className={`${rootClass} ${modClass}${visual.dimmed ? " ds-threat-icon--dimmed" : ""}${visual.showInTopBar ? " ds-threat-icon--critical" : ""}`}
      style={{ color: visual.accentColor }}
      title={title}
      aria-hidden
    >
      {visual.glyph}
    </span>
  );
}
