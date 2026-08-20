type StatusReasonChipProps = {
  /** Человекочитаемый title статуса/типа события (из статус-словаря). */
  label: string;
  /** Цвет акцента угрозы (SSOT resolveThreatVisual) — если применим. */
  accentColor?: string;
};

/**
 * Чип причины/типа события (pvo_work, danger, cleared…) рядом с уровневым Badge.
 * Усекается многоточием на узкой панели — полный текст остаётся в title (hover).
 */
export function StatusReasonChip({ label, accentColor }: StatusReasonChipProps) {
  return (
    <span
      className="ds-status-chip"
      title={label}
      style={accentColor ? { borderColor: accentColor, color: accentColor } : undefined}
    >
      {label}
    </span>
  );
}
