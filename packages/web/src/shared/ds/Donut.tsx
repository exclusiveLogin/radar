export type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

type DonutProps = {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
};

/** Кольцевая диаграмма распределения (чистый SVG). */
export function Donut({ segments, size = 80, strokeWidth = 14 }: DonutProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  let offset = 0;

  const arcs = segments
    .filter((s) => s.value > 0)
    .map((segment) => {
      const fraction = total > 0 ? segment.value / total : 0;
      const dash = fraction * circumference;
      const gap = circumference - dash;
      const currentOffset = offset;
      offset += dash;
      return (
        <circle
          key={segment.label}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={segment.color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${dash} ${gap}`}
          strokeDashoffset={-currentOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      );
    });

  return (
    <div className="ds-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {total === 0 ? (
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={strokeWidth}
          />
        ) : (
          arcs
        )}
      </svg>
      <div className="ds-donut__legend">
        {segments.map((s) => (
          <div key={s.label} className="ds-donut__legend-item">
            <span
              className="ds-donut__legend-dot"
              style={{ background: s.color }}
            />
            <span>{s.label}</span>
            <span className="ds-muted">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
