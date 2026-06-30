/**

 * ---

 * layer: shared

 * kind: domain service

 * domain: tracking/nextgen

 * purpose: H3-поле — модуль (частотность точек) и роза векторов (cos) раздельно.

 * ---

 */



import { cellToParent, getResolution, latLngToCell } from "h3-js";

import bearing from "@turf/bearing";



/** Секторов в розе направлений (45° каждый). */

const SECTOR_COUNT = 8;

const SECTOR_DEG = 360 / SECTOR_COUNT;

/** Иерархическая пирамида H3: base + 2 родительских уровня. */
const FLOW_PYRAMID_LEVEL_OFFSETS = [0, 1, 2] as const;
/** Коэффициенты записи/чтения: fine важнее coarse для локальной точности. */
const FLOW_PYRAMID_WEIGHTS = [1, 0.6, 0.35] as const;



/** Снимок поля: роза векторов + модуль массы по ячейкам. */

export type FlowMapSnapshot = {

  vectors: Record<string, number[]>;

  mass: Record<string, number>;

};



/** Агрегат ячейки — роза направлений (для cos), модуль отдельно. */

export interface H3CellFlow {

  /** Сумма cos-весов в розе (не модуль точек). */

  vectorWeight: number;

  /** Согласованность направлений ∈ [0,1]. */

  concentration: number;

  /** Доминирующий азимут розы (градусы). */

  bearingDeg: number;

  /** Накопленный модуль (частотность точек) в ячейке. */

  cellMass: number;

}



export class H3VectorFlowMap {

  /** h3Index → роза векторов [w0..w7], веса = cos-компонента отрезков. */

  private readonly histogram = new Map<string, number[]>();

  /** h3Index → модуль (сумма mass точек / событий). */

  private readonly massByCell = new Map<string, number>();



  constructor(private readonly resolution: number = 8) {}



  /** H3-индекс ячейки; null — невалидные координаты. */

  private cellIndexOf(lat: number, lon: number): string | null {

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    return latLngToCell(lat, lon, this.resolution);

  }

  /** Ячейка и её родители до res-2 (если доступны на текущем resolution). */
  private pyramidCells(baseCell: string): Array<{ cell: string; weight: number }> {
    const baseResolution = getResolution(baseCell);
    const cells: Array<{ cell: string; weight: number }> = [];

    for (let i = 0; i < FLOW_PYRAMID_LEVEL_OFFSETS.length; i++) {
      const offset = FLOW_PYRAMID_LEVEL_OFFSETS[i]!;
      const targetResolution = baseResolution - offset;
      if (targetResolution < 0) break;
      const cell = offset === 0 ? baseCell : cellToParent(baseCell, targetResolution);
      cells.push({ cell, weight: FLOW_PYRAMID_WEIGHTS[i]! });
    }
    return cells;
  }

  /** Пирамида по координате старта: fine + coarse уровни. */
  private pyramidCellsOf(lat: number, lon: number): Array<{ cell: string; weight: number }> {
    const baseCell = this.cellIndexOf(lat, lon);
    return baseCell == null ? [] : this.pyramidCells(baseCell);
  }



  /**

   * Модуль ячейки — частотность/масса точек (Ф2).

   * На Ф3 используется как гравитационный магнит без учёта направления.

   */

  public registerCellMass(lat: number, lon: number, mass: number): void {

    if (mass <= 0) return;

    const pyramid = this.pyramidCellsOf(lat, lon);
    if (pyramid.length === 0) return;

    for (const { cell, weight } of pyramid) {
      const weightedMass = mass * weight;
      this.massByCell.set(cell, (this.massByCell.get(cell) ?? 0) + weightedMass);
    }

  }



  /**

   * Роза векторов — направление отрезка с весом cos (согласованность потоку).

   * Противоток (cosWeight ≤ 0) в розу не пишем.

   */

  public registerVectorRose(

    lat1: number,

    lon1: number,

    lat2: number,

    lon2: number,

    cosWeight: number,

  ): void {

    if (cosWeight <= 0) return;

    const pyramid = this.pyramidCellsOf(lat1, lon1);
    if (pyramid.length === 0) return;

    const angle = this.calculateBearing(lat1, lon1, lat2, lon2);

    const sector = this.getSectorIndex(angle);

    for (const { cell, weight } of pyramid) {
      let hist = this.histogram.get(cell);
      if (!hist) {
        hist = new Array(SECTOR_COUNT).fill(0);
        this.histogram.set(cell, hist);
      }
      hist[sector] += cosWeight * weight;
    }

  }



  /** @deprecated Используй registerVectorRose — совместимость с registerObservedFlows. */

  public registerFlow(

    lat1: number,

    lon1: number,

    lat2: number,

    lon2: number,

    cosWeight = 1,

  ): void {

    this.registerVectorRose(lat1, lon1, lat2, lon2, cosWeight);

  }



  /** cos∠(шаг A→B, роза ячейки старта) ∈ [-1, 1]. */

  public getFlowAlignment(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const angle = this.calculateBearing(lat1, lon1, lat2, lon2);
    const pyramid = this.pyramidCellsOf(lat1, lon1);
    if (pyramid.length === 0) return 0;

    let weightedAlignment = 0;
    let totalPyramidWeight = 0;

    for (const { cell, weight } of pyramid) {
      const hist = this.histogram.get(cell);
      if (!hist) continue;
      const totalWeight = hist.reduce((sum, w) => sum + w, 0);
      if (totalWeight <= 0) continue;

      let alignment = 0;
      for (let i = 0; i < SECTOR_COUNT; i++) {
        if (hist[i]! <= 0) continue;
        const sectorCenterAngle = i * SECTOR_DEG + SECTOR_DEG / 2;
        const cosSim = this.cosSimilarityDegrees(angle, sectorCenterAngle);
        alignment += cosSim * (hist[i]! / totalWeight);
      }
      weightedAlignment += alignment * weight;
      totalPyramidWeight += weight;
    }

    return totalPyramidWeight > 0 ? weightedAlignment / totalPyramidWeight : 0;

  }



  /** Сырой модуль ячейки (сумма mass точек). */

  public cellMass(lat: number, lon: number): number {
    const pyramid = this.pyramidCellsOf(lat, lon);
    if (pyramid.length === 0) return 0;

    let weightedMass = 0;
    let totalPyramidWeight = 0;
    for (const { cell, weight } of pyramid) {
      const mass = this.massByCell.get(cell) ?? 0;
      if (mass <= 0) continue;
      weightedMass += mass * weight;
      totalPyramidWeight += weight;
    }
    return totalPyramidWeight > 0 ? weightedMass / totalPyramidWeight : 0;

  }



  /** Агрегат розы + модуль для диагностики. */

  public cellFlow(lat: number, lon: number): H3CellFlow | null {

    const h3 = this.cellIndexOf(lat, lon);

    if (h3 == null) return null;



    const cellMass = this.massByCell.get(h3) ?? 0;

    const hist = this.histogram.get(h3);



    if (!hist && cellMass <= 0) return null;



    let vectorWeight = 0;

    let vx = 0;

    let vy = 0;



    if (hist) {

      for (let i = 0; i < SECTOR_COUNT; i++) {

        const w = hist[i]!;

        if (w <= 0) continue;

        vectorWeight += w;

        const centerDeg = i * SECTOR_DEG + SECTOR_DEG / 2;

        const rad = (centerDeg * Math.PI) / 180;

        vx += w * Math.sin(rad);

        vy += w * Math.cos(rad);

      }

    }



    if (vectorWeight <= 0 && cellMass <= 0) return null;



    const resultant = Math.hypot(vx, vy);

    return {

      vectorWeight,

      concentration: vectorWeight > 0 ? resultant / vectorWeight : 0,

      bearingDeg: vectorWeight > 0

        ? ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360

        : 0,

      cellMass,

    };

  }



  /**

   * Нормированный модуль ячейки ∈ [0,1) — только mass, без cos.

   * Ф3: магнит точки по частотности.

   */

  public cellStrength(lat: number, lon: number, saturationK = 4): number {

    const m = this.cellMass(lat, lon);

    if (m <= 0) return 0;

    return m / (m + saturationK);

  }



  public exportSnapshot(): FlowMapSnapshot {

    const vectors: Record<string, number[]> = {};

    for (const [cell, hist] of this.histogram.entries()) {

      vectors[cell] = [...hist];

    }

    const mass: Record<string, number> = {};

    for (const [cell, m] of this.massByCell.entries()) {

      mass[cell] = m;

    }

    return { vectors, mass };

  }



  public loadSnapshot(snapshot: FlowMapSnapshot): void {

    this.histogram.clear();

    this.massByCell.clear();

    for (const [cell, hist] of Object.entries(snapshot.vectors)) {

      this.histogram.set(cell, [...hist]);

    }

    for (const [cell, m] of Object.entries(snapshot.mass)) {

      this.massByCell.set(cell, m);

    }

  }



  private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {

    let b = bearing([lon1, lat1], [lon2, lat2]);

    if (b < 0) b += 360;

    return b;

  }



  private getSectorIndex(angleDegrees: number): number {

    const a = (angleDegrees % 360 + 360) % 360;

    return Math.floor(a / SECTOR_DEG);

  }



  private cosSimilarityDegrees(deg1: number, deg2: number): number {

    const rad = (deg1 - deg2) * (Math.PI / 180);

    return Math.cos(rad);

  }

}


