import assert from "node:assert/strict";
import test from "node:test";
import type { MapRegionSnapshot } from "@radar/shared";
import {
  buildCompactLayoutGrid,
  compactTile,
  fitViewBoxFromCenters,
} from "./compactLayoutGrid.js";

function tile(col: number, row: number): MapRegionSnapshot {
  return {
    regionId: `id-${col}-${row}`,
    regionCode: `RU-${col}${row}`,
    name: "test",
    stateLevel: "grey",
    activity: 0,
    layout: { col, row },
  };
}

test("buildCompactLayoutGrid убирает пустые col/row", () => {
  const grid = buildCompactLayoutGrid([
    tile(0, 0),
    tile(5, 0),
    tile(0, 3),
  ]);
  assert.ok(grid);
  assert.equal(grid.compactCols, 2);
  assert.equal(grid.compactRows, 2);
  assert.deepEqual(compactTile(grid, 5, 3), { col: 1, row: 1 });
});

test("fitViewBoxFromCenters: bbox только по переданным центрам", () => {
  const box = fitViewBoxFromCenters(
    [{ cx: 100, cy: 50 }],
    28,
    16,
    { width: 900, height: 600 },
  );
  assert.match(box, /^56 /);
  assert.notEqual(box, "0 0 900 600");
});
