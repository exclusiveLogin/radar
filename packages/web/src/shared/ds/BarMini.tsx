import { useEffect, useRef, useState } from "react";

type BarMiniProps = {
  bars: { key?: string; label: string; value: number; color?: string; tip?: string }[];
  /** Фикс. ширина; если не задана — растягивается на контейнер. */
  width?: number;
  height?: number;
};

/** Мини-столбчатая диаграмма на SVG. */
export function BarMini({ bars, width, height = 48 }: BarMiniProps) {
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

  if (bars.length === 0) return null;

  const max = Math.max(...bars.map((b) => b.value), 1);
  const barWidth = Math.max(4, (w - bars.length * 2) / bars.length);
  const gap = 2;

  const svg = (
    <svg className="ds-bar-mini" width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
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

  if (width != null) return svg;

  return (
    <div ref={wrapRef} className="ds-chart-fluid">
      {svg}
    </div>
  );
}
