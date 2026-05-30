type StatTileProps = {
  label: string;
  value: number | string;
  /** Цвет индикатора (уровень состояния). */
  dotColor?: string;
};

/** KPI-плитка: значение + подпись. */
export function StatTile({ label, value, dotColor }: StatTileProps) {
  return (
    <div className="ds-stat-tile">
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {dotColor && (
          <span className="ds-stat-tile__dot" style={{ background: dotColor }} />
        )}
        <span className="ds-stat-tile__value">{value}</span>
      </div>
      <span className="ds-stat-tile__label">{label}</span>
    </div>
  );
}
