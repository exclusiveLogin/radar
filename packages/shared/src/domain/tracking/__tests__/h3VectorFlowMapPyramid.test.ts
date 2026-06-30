import { cellToParent, latLngToCell } from "h3-js";
import { describe, expect, test } from "vitest";
import { H3VectorFlowMap } from "../nextgen/flow-map/H3VectorFlowMap";

type GeoPoint = { lat: number; lon: number };

/**
 * Ищет соседнюю точку в другом res-cell, но в том же родителе (res-1).
 * Нужна для проверки sparse-сценария: fine пустой, coarse уже обучен.
 */
function findSiblingPointInSameParent(base: GeoPoint, resolution: number): GeoPoint {
  const baseCell = latLngToCell(base.lat, base.lon, resolution);
  const baseParent = cellToParent(baseCell, resolution - 1);

  for (let i = 1; i <= 80; i++) {
    const lon = base.lon + i * 0.003;
    const cell = latLngToCell(base.lat, lon, resolution);
    if (cell === baseCell) continue;
    if (cellToParent(cell, resolution - 1) === baseParent) {
      return { lat: base.lat, lon };
    }
  }

  throw new Error("Failed to find sibling H3 cell under the same parent");
}

describe("H3VectorFlowMap pyramid alignment", () => {
  test("coarse уровень помогает в пустом fine-cell", () => {
    const resolution = 8;
    const map = new H3VectorFlowMap(resolution);
    const anchor = { lat: 50.45, lon: 30.52 };
    const sibling = findSiblingPointInSameParent(anchor, resolution);

    // Обучаем поток на anchor-cell в восточном направлении.
    for (let i = 0; i < 6; i++) {
      map.registerVectorRose(anchor.lat, anchor.lon, anchor.lat, anchor.lon + 0.06, 1);
    }

    const along = map.getFlowAlignment(
      sibling.lat,
      sibling.lon,
      sibling.lat,
      sibling.lon + 0.06,
    );
    const against = map.getFlowAlignment(
      sibling.lat,
      sibling.lon,
      sibling.lat,
      sibling.lon - 0.06,
    );

    expect(along).toBeGreaterThan(0.15);
    expect(along).toBeGreaterThan(against);
  });

  test("fine уровень приоритетнее coarse при конфликте направлений", () => {
    const resolution = 8;
    const map = new H3VectorFlowMap(resolution);
    const anchor = { lat: 50.45, lon: 30.52 };
    const sibling = findSiblingPointInSameParent(anchor, resolution);

    // Coarse фон: восток от соседней ячейки.
    for (let i = 0; i < 4; i++) {
      map.registerVectorRose(anchor.lat, anchor.lon, anchor.lat, anchor.lon + 0.06, 1);
    }
    // Fine сигнал в целевой ячейке: запад должен перевесить локально.
    for (let i = 0; i < 6; i++) {
      map.registerVectorRose(sibling.lat, sibling.lon, sibling.lat, sibling.lon - 0.06, 1);
    }

    const west = map.getFlowAlignment(
      sibling.lat,
      sibling.lon,
      sibling.lat,
      sibling.lon - 0.06,
    );
    const east = map.getFlowAlignment(
      sibling.lat,
      sibling.lon,
      sibling.lat,
      sibling.lon + 0.06,
    );

    expect(west).toBeGreaterThan(east);
  });

  test("cellStrength учитывает иерархическую массу для sparse-точек", () => {
    const resolution = 8;
    const map = new H3VectorFlowMap(resolution);
    const anchor = { lat: 50.45, lon: 30.52 };
    const sibling = findSiblingPointInSameParent(anchor, resolution);

    map.registerCellMass(anchor.lat, anchor.lon, 5);
    expect(map.cellStrength(sibling.lat, sibling.lon)).toBeGreaterThan(0);
  });
});

