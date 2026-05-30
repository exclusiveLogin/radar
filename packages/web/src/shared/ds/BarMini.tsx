type BarMiniProps = {
  bars: { key?: string; label: string; value: number; color?: string; tip?: string }[];
  width?: number;
  height?: number;
};

/** Мини-столбчатая диаграмма на SVG. */
export function BarMini({ bars, width = 200, height = 48 }: BarMiniProps) {
  if (bars.length === 0) return null;

  const max = Math.max(...bars.map((b) => b.value), 1);
  const barWidth = Math.max(4, (width - bars.length * 2) / bars.length);
  const gap = 2;

  return (
    <svg className="ds-bar-mini" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {bars.map((bar, i) => {
        const barH = (bar.value / max) * (height - 14);
        const x = i * (barWidth + gap);
        const y = height - barH - 12;
        return (
          <g key={bar.key ?? bar.label}>
            <title>{`${bar.tip ?? bar.label}: ${bar.value}`}</title>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barH}
              fill={bar.color ?? "var(--accent)"}
              rx={2}
            />
            <text
              x={x + barWidth / 2}
              y={height - 2}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize={8}
            >
              {bar.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
