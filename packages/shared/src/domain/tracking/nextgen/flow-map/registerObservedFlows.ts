/**

 * Обучение H3: модуль точек + роза наблюдённых шагов (cos-вес = trust).

 */

import { haversineDistanceM } from "../../haversine";

import type { TrackingCandidate } from "../../types";

import type { H3VectorFlowMap } from "./H3VectorFlowMap";



/**

 * Регистрирует наблюдённые перемещения между соседними по времени кандидатами.

 */

export function registerObservedFlows(

  flowMap: H3VectorFlowMap,

  candidates: TrackingCandidate[],

  maxGapMs: number,

  maxLinkDistanceM: number,

): void {

  if (candidates.length < 2) return;



  const sorted = [...candidates].sort(

    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),

  );



  for (const c of sorted) {

    flowMap.registerCellMass(c.lat, c.lon, Math.max(0.1, c.trust ?? 1));

  }



  for (let i = 1; i < sorted.length; i++) {

    const prev = sorted[i - 1]!;

    const curr = sorted[i]!;

    const dtMs = curr.occurredAt.getTime() - prev.occurredAt.getTime();

    if (dtMs <= 0 || dtMs > maxGapMs) continue;



    const dist = haversineDistanceM(prev.lat, prev.lon, curr.lat, curr.lon);

    if (dist > maxLinkDistanceM) continue;



    const cosWeight = Math.max(0.1, prev.trust ?? 1);

    flowMap.registerVectorRose(prev.lat, prev.lon, curr.lat, curr.lon, cosWeight);

  }

}


