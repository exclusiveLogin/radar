import type { MapRegionSnapshot } from "@radar/shared";

/** Сжатие разреженного col/row layout → подряд без пустых столбцов/рядов. */
export type CompactLayoutGrid = {
  colToCompact: Map<number, number>;
  rowToCompact: Map<number, number>;
  compactCols: number;
  compactRows: number;
};

export function buildCompactLayoutGrid(
  regions: MapRegionSnapshot[],
): CompactLayoutGrid | null {
  if (regions.length === 0) return null;

  const usedCols = [...new Set(regions.map((r) => r.layout!.col))].sort(
    (a, b) => a - b,
  );
  const usedRows = [...new Set(regions.map((r) => r.layout!.row))].sort(
    (a, b) => a - b,
  );

  return {
    colToCompact: new Map(usedCols.map((col, index) => [col, index])),
    rowToCompact: new Map(usedRows.map((row, index) => [row, index])),
    compactCols: usedCols.length,
    compactRows: usedRows.length,
  };
}

export function compactTile(
  grid: CompactLayoutGrid,
  col: number,
  row: number,
): { col: number; row: number } {
  return {
    col: grid.colToCompact.get(col) ?? col,
    row: grid.rowToCompact.get(row) ?? row,
  };
}

/** viewBox «fit» по центрам сот (minX, minY, width, height). */
export function fitViewBoxFromCenters(
  centers: Array<{ cx: number; cy: number }>,
  hexR: number,
  padding: number,
  fallback: { width: number; height: number },
): string {
  if (centers.length === 0) {
    return `0 0 ${fallback.width} ${fallback.height}`;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { cx, cy } of centers) {
    minX = Math.min(minX, cx - hexR);
    maxX = Math.max(maxX, cx + hexR);
    minY = Math.min(minY, cy - hexR);
    maxY = Math.max(maxY, cy + hexR);
  }

  const x = minX - padding;
  const y = minY - padding;
  const w = maxX - minX + padding * 2;
  const h = maxY - minY + padding * 2;
  return `${x} ${y} ${w} ${h}`;
}
