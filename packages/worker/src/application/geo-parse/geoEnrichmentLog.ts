import type { PlaceEnrichmentProvider } from "@radar/shared";

/** Подробный лог каждого place (как parse:snap по шагам dadata). */
export function isVerboseGeoEnrichmentLog(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.RADAR_VERBOSE_GEO_LOG?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Итог батча geoParse — всегда в консоль worker (ingest daemon так же молчит по msg, но geo раньше вообще ничего). */
export function logGeoBatchSummary(input: {
  phaseId?: string;
  provider: PlaceEnrichmentProvider;
  claimed: number;
  processed: number;
  failed: number;
  catchUpEnqueued?: number;
}): void {
  const prefix = input.phaseId ? `GeoParse[${input.phaseId}]` : `geo[${input.provider}]`;
  const catchUp =
    input.catchUpEnqueued != null && input.catchUpEnqueued > 0
      ? ` catch-up=+${input.catchUpEnqueued}`
      : "";
  console.log(
    `${prefix} provider=${input.provider}${catchUp} claimed=${input.claimed} ok=${input.processed} failed=${input.failed}`,
  );
}

/** Короткая строка на каждый place — видно движение в консоли (~1/с для nominatim). */
export function logGeoPlaceOutcome(input: {
  provider: PlaceEnrichmentProvider;
  placeName: string;
  outcome: "ok" | "miss" | "skip" | "fail";
}): void {
  console.log(`[geo:${input.provider}] ${input.outcome} ${input.placeName}`);
}

export function logGeoPlaceVerbose(input: {
  provider: PlaceEnrichmentProvider;
  placeId: string;
  placeName: string;
  query: string;
  outcome: "merged" | "no_hit" | "skip_region" | "error";
  detail?: string;
}): void {
  if (!isVerboseGeoEnrichmentLog()) return;
  const extra = input.detail ? ` ${input.detail}` : "";
  console.log(
    `[geo:${input.provider}] ${input.outcome} place=${input.placeName} id=${input.placeId} query="${input.query}"${extra}`,
  );
}
