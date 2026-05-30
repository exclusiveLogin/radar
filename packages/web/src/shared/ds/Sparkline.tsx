type SparklineProps = {
  /** Значения по времени (порядок сохраняется). */
  values: number[];
  width?: number;
  height?: number;
  color?: string;
};

/** Мини-линейный график (sparkline) на SVG. */
export function Sparkline({
  values,
  width = 200,
  height = 48,
  color = "var(--accent)",
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <svg className="ds-sparkline" width={width} height={height}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="var(--text-muted)" fontSize={11}>
          нет данных
        </text>
      </svg>
    );
  }

  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - (v / max) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg className="ds-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polygon points={areaPoints} fill={color} opacity={0.15} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
