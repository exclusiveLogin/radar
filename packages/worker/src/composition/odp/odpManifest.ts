/**
 * ---
 * layer: worker/composition
 * domain: odp
 * purpose: Operational Domain Profile — декларативный список известных pipeline-контекстов
 *          (`tracking`/`parse`/`geo-enrich`) и способ узнать их текущий рантайм (runner-platform
 *          за флагом / legacy-демон). ODP не знает internals runner platform (jobKernel/workbook) —
 *          только читает уже опубликованные флаг-функции каждого домена. Runner platform, в свою
 *          очередь, не знает про ODP/workbook типы (см. runnerContracts.ts).
 * ---
 */
import { isTrackingRunnerPlatformEnabled } from "../../application/tracking/runner/trackingRunner.js";
import { ParseRunnerRegistry } from "../../application/parse/runner/parseRunnerRegistry.js";
import { isGeoEnrichRunnerPlatformEnabled } from "../../application/geo-parse/runner/geoEnrichRunner.js";

export type OdpPipelineKey = "tracking" | "parse" | "geo-enrich";

export type OdpManifestEntry = {
  pipelineKey: OdpPipelineKey;
  label: string;
  /** true — активен runner-platform workload за флагом; false — legacy-демон (default). */
  runnerPlatformEnabled: () => boolean;
};

export const ODP_MANIFEST: readonly OdpManifestEntry[] = [
  {
    pipelineKey: "tracking",
    label: "NextGen track rebuild (cluster+field_train+join)",
    runnerPlatformEnabled: isTrackingRunnerPlatformEnabled,
  },
  {
    pipelineKey: "parse",
    label: "ingestParse scheduled phases (queue_parse_coverage claim-drain)",
    runnerPlatformEnabled: ParseRunnerRegistry.enabled,
  },
  {
    pipelineKey: "geo-enrich",
    label: "geoParse scheduled phases (dadata → nominatim → llm)",
    runnerPlatformEnabled: isGeoEnrichRunnerPlatformEnabled,
  },
];
