/**

 * ---

 * layer: shared

 * kind: domain

 * domain: tracking/nextgen

 * purpose: Ф2 → H3: модуль точек + роза векторов (cos) отрезков.

 * ---

 */

import type { H3VectorFlowMap } from "./H3VectorFlowMap";

import type { NextGenSegment } from "../step2-attention/NextGenStep2";

import type { NextGenNode } from "../step1-stdbscan/NextGenStep1";



/** Частотность: каждая нода Ф1 добавляет mass в свою H3-ячейку. */

export function registerNodeMasses(

  flowMap: H3VectorFlowMap,

  nodes: readonly NextGenNode[],

): void {

  for (const node of nodes) {

    flowMap.registerCellMass(node.lat, node.lon, node.mass);

  }

}



/** Роза: отрезки с cos-весом (согласованность потоку), модуль уже в точках. */

export function registerSegmentFlows(

  flowMap: H3VectorFlowMap,

  segments: readonly NextGenSegment[],

): void {

  for (const seg of segments) {

    flowMap.registerVectorRose(

      seg.from.lat,

      seg.from.lon,

      seg.to.lat,

      seg.to.lon,

      seg.vectorWeight,

    );

  }

}


