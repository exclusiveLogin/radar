/**
 * ---
 * layer: worker/composition
 * domain: odp
 * purpose: Типы pipeline-ключей ODP. Рантайм — только через odpResolve(deployment manifest).
 * ---
 */
export type OdpPipelineKey = "tracking" | "parse" | "geo-enrich";
