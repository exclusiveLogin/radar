import { useEffect, useRef, useState } from "react";

type SparklineProps = {
  /** Значения по времени (порядок сохраняется). */
  values: number[];
  /** Фикс. ширина; если не задана — растягивается на контейнер. */
  width?: number;
  height?: number;
  color?: string;
};

function SparklineSvg({
  values,
  width,
  height,
  color,
}: {
  values: number[];
  width: number;
  height: number;
  color: string;
}) {
  if (values.length === 0) {
    return (
      <svg className="ds-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
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

/** Мини-линейный график (sparkline) на SVG. */
export function Sparkline({
  values,
  width,
  height = 48,
  color = "var(--accent)",
}: SparklineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(280);
  const w = width ?? measured;

  useEffect(() => {
    if (width != null) return;
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setMeasured(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const svg = <SparklineSvg values={values} width={w} height={height} color={color} />;
  if (width != null) return svg;

  return (
    <div ref={wrapRef} className="ds-chart-fluid">
      {svg}
    </div>
  );
}
