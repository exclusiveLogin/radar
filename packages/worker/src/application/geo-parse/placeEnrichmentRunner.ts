import { canonicalRegionCode, isGeoEnrichEligibleKind, type IPlaceAliasRepository, type IPlaceEnrichmentJobRepository, type IPlaceRepository, type IRegionRepository, type PlaceContribution, type PlaceEnrichmentJobRecord, type PlaceEnrichmentProvider, type PlaceRecord, type WorkItemResult, buildCatalogPlaceGeocodeQuery, parseRegionViewbox, resolveNominatimCountryCode } from "@radar/shared";
import type { PlaceEnrichmentEnrichers } from "./placeGeoEnricherPort.js";
import {
  isGarbageIngestPlaceName,
  normalizePlaceLabelForGeocode,
} from "../../domain/parsing/channelCityListPromo.js";
import { enrichmentMissError } from "../../domain/parsing/placeEnrichmentStatus.js";
import {
  logGeoBatchSummary,
  logGeoPlaceOutcome,
  logGeoPlaceVerbose,
} from "./geoEnrichmentLog.js";

const PROVIDER_SCORE: Record<PlaceEnrichmentProvider, number> = {
  dadata: 0.95,
  nominatim: 0.8,
  llm: 0.55,
};

function toTrust(score: number): {
  trustState: "unverified" | "partially_verified" | "verified";
  isTrusted: boolean;
} {
  if (score >= 0.9) return { trustState: "verified", isTrusted: true };
  if (score >= 0.7) return { trustState: "partially_verified", isTrusted: false };
  return { trustState: "unverified", isTrusted: false };
}

export class PlaceEnrichmentRunner {
  constructor(
    private readonly jobs: IPlaceEnrichmentJobRepository,
    private readonly places: IPlaceRepository,
    private readonly aliases: IPlaceAliasRepository,
    private readonly regions: IRegionRepository,
    private readonly enrichers: PlaceEnrichmentEnrichers,
  ) {}

  private getDadata() {
    return this.enrichers.getDadata();
  }

  private get nominatim() {
    return this.enrichers.nominatim;
  }

  private get llm() {
    return this.enrichers.llm;
  }

  private isDadataSuggestionsBlocked(provider: PlaceEnrichmentProvider): boolean {
    return provider === "dadata" && Boolean(this.getDadata().isSuggestionsBlocked?.());
  }

  /** Мусорный place: не дергаем внешний API, помечаем провайдера в evidence — без повторного catch-up. */
  private async skipNonGeocodablePlace(
    jobId: string,
    placeId: string,
    provider: PlaceEnrichmentProvider,
  ): Promise<void> {
    await this.places.mergeContribution({
      placeId,
      provider,
      trustState: "rejected",
      isTrusted: false,
      trustScore: 0,
      fields: {},
      rawPayload: { skipReason: "non_geocodable_place_name" },
    });
    await this.jobs.markDone(jobId);
  }

  /** DaData 403 SUGGESTIONS — jobs обратно в pending, batch прерываем. */
  private async abortBatchOnDadataBlocked(
    claimed: Array<{ id: string }>,
    fromIndex: number,
  ): Promise<void> {
    const remaining = claimed.slice(fromIndex).map((job) => job.id);
    const released = await this.jobs.releaseToPending(remaining);
    if (released > 0) {
      console.warn(
        `[geo:dadata] SUGGESTIONS disabled — ${released} jobs возвращены в pending (не failed)`,
      );
    }
  }

  /** FIAS занят другим place — merge без fiasId, иначе places_fias_id_key. */
  private async sanitizeContribution(
    placeId: string,
    contribution: PlaceContribution,
  ): Promise<PlaceContribution> {
    const fiasId = contribution.fields.fiasId;
    if (!fiasId) return contribution;
    const other = await this.places.findByFias(fiasId);
    if (!other || other.id === placeId) return contribution;
    const { fiasId: _drop, ...fields } = contribution.fields;
    return { ...contribution, fields };
  }

  /** merge contribution; job done по факту успешного merge. */
  private async applyContribution(
    placeId: string,
    provider: PlaceEnrichmentProvider,
    contribution: PlaceContribution,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const safe = await this.sanitizeContribution(placeId, contribution);
    try {
      await this.places.mergeContribution(safe);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: message };
    }
    return { ok: true };
  }

  async runBatch(
    provider: PlaceEnrichmentProvider,
    limit: number,
    logContext?: { phaseId?: string },
    targetedPlaceIds?: string[],
  ): Promise<{ claimed: number; processed: number; failed: number }> {
    if (this.isDadataSuggestionsBlocked(provider)) {
      return { claimed: 0, processed: 0, failed: 0 };
    }

    const claimed = targetedPlaceIds?.length
      ? await this.jobs.claimForPlaceIds(provider, targetedPlaceIds)
      : await this.jobs.claimEligibleBatch(provider, limit);
    if (claimed.length === 0) {
      return { claimed: 0, processed: 0, failed: 0 };
    }

    const regionsById = new Map((await this.regions.listActive()).map((row) => [row.id, row]));
    const placeIds = [...new Set(claimed.map((job) => job.placeId))];
    const placesById = new Map<string, PlaceRecord>();
    for (const placeId of placeIds) {
      const place = await this.places.findById(placeId);
      if (place) placesById.set(placeId, place);
    }
    const parentIds = [
      ...new Set(
        [...placesById.values()]
          .map((place) => place.parentPlaceId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    for (const parentId of parentIds) {
      if (placesById.has(parentId)) continue;
      const parent = await this.places.findById(parentId);
      if (parent) placesById.set(parentId, parent);
    }

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < claimed.length; i += 1) {
      const job = claimed[i]!;
      try {
        const place = placesById.get(job.placeId) ?? (await this.places.findById(job.placeId));
        if (!place || place.kind === "region") {
          const placeName = place?.name ?? job.placeId;
          logGeoPlaceOutcome({ provider, placeName, outcome: "skip" });
          logGeoPlaceVerbose({
            provider,
            placeId: job.placeId,
            placeName,
            query: "",
            outcome: "skip_region",
          });
          await this.jobs.markDone(job.id);
          processed += 1;
          continue;
        }
        if (!isGeoEnrichEligibleKind(place.kind)) {
          logGeoPlaceOutcome({ provider, placeName: place.name, outcome: "skip" });
          logGeoPlaceVerbose({
            provider,
            placeId: place.id,
            placeName: place.name,
            query: "",
            outcome: "skip_region",
            detail: "kind_below_city",
          });
          await this.jobs.markDone(job.id);
          processed += 1;
          continue;
        }
        const region = regionsById.get(place.regionId);
        if (!region) {
          logGeoPlaceOutcome({ provider, placeName: place.name, outcome: "fail" });
          await this.jobs.markFailed(job.id, `${provider}: region not found`);
          failed += 1;
          continue;
        }
        if (isGarbageIngestPlaceName(place.name)) {
          await this.skipNonGeocodablePlace(job.id, place.id, provider);
          logGeoPlaceOutcome({ provider, placeName: place.name, outcome: "skip" });
          logGeoPlaceVerbose({
            provider,
            placeId: place.id,
            placeName: place.name,
            query: "",
            outcome: "skip_region",
            detail: "non_geocodable_place_name",
          });
          processed += 1;
          continue;
        }
        const regionCode = canonicalRegionCode(region);
        const parent = place.parentPlaceId ? placesById.get(place.parentPlaceId) : undefined;
        const placeLabel = normalizePlaceLabelForGeocode(place.name);
        const query = buildCatalogPlaceGeocodeQuery({
          placeName: placeLabel,
          placeNameWithType: place.nameWithType
            ? normalizePlaceLabelForGeocode(place.nameWithType)
            : undefined,
          region,
          parentPlaceName: parent?.name,
          parentPlaceNameWithType: parent?.nameWithType,
        });
        const nominatimHints =
          provider === "nominatim"
            ? {
                countryCode: resolveNominatimCountryCode(region.iso),
                viewbox: parseRegionViewbox(region.bbox),
              }
            : undefined;

        const contribution = await this.buildContribution(
          provider,
          place.id,
          query,
          regionCode,
          nominatimHints,
        );
        if (!contribution) {
          if (this.isDadataSuggestionsBlocked(provider)) {
            await this.abortBatchOnDadataBlocked(claimed, i);
            break;
          }
          logGeoPlaceOutcome({ provider, placeName: place.name, outcome: "miss" });
          logGeoPlaceVerbose({
            provider,
            placeId: place.id,
            placeName: place.name,
            query,
            outcome: "no_hit",
          });
          await this.jobs.markFailed(job.id, enrichmentMissError(provider));
          failed += 1;
          continue;
        }
        const applied = await this.applyContribution(place.id, provider, contribution);
        if (!applied.ok) {
          logGeoPlaceOutcome({ provider, placeName: place.name, outcome: "fail" });
          console.warn(
            `[geo:${provider}] merge fail place=${place.name} query=${JSON.stringify(query)} ${applied.reason}`,
          );
          await this.jobs.markFailed(job.id, applied.reason);
          failed += 1;
          continue;
        }
        if (contribution.fields.name) {
          await this.aliases.upsertAlias({
            placeId: place.id,
            alias: contribution.fields.name,
            source: "auto",
          });
        }
        logGeoPlaceOutcome({ provider, placeName: place.name, outcome: "ok" });
        logGeoPlaceVerbose({
          provider,
          placeId: place.id,
          placeName: place.name,
          query,
          outcome: "merged",
          detail: contribution.fields.fiasId ? `fias=${contribution.fields.fiasId}` : undefined,
        });
        await this.jobs.markDone(job.id);
        processed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        const place = await this.places.findById(job.placeId);
        logGeoPlaceOutcome({
          provider,
          placeName: place?.name ?? job.placeId,
          outcome: "fail",
        });
        logGeoPlaceVerbose({
          provider,
          placeId: job.placeId,
          placeName: place?.name ?? job.placeId,
          query: "",
          outcome: "error",
          detail: message,
        });
        await this.jobs.markFailed(job.id, message);
      }
    }

    logGeoBatchSummary({
      phaseId: logContext?.phaseId,
      provider,
      claimed: claimed.length,
      processed,
      failed,
    });
    return { claimed: claimed.length, processed, failed };
  }

  async runDrain(
    provider: PlaceEnrichmentProvider,
    batchSize: number,
    options?: { onBatch?: (stats: { processed: number; failed: number; claimed: number }) => void },
  ): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    for (;;) {
      const batch = await this.runBatch(provider, batchSize);
      processed += batch.processed;
      failed += batch.failed;
      options?.onBatch?.({ processed, failed, claimed: batch.claimed });
      if (batch.claimed === 0) break;
    }
    return { processed, failed };
  }

  private async buildContribution(
    provider: PlaceEnrichmentProvider,
    placeId: string,
    query: string,
    regionCode: string | undefined,
    nominatimHints?: {
      countryCode?: string;
      viewbox?: ReturnType<typeof parseRegionViewbox>;
    },
  ): Promise<PlaceContribution | null> {
    if (provider === "dadata") {
      const hit = await this.getDadata().enrich({ rawText: query, regionCode });
      if (!hit) return null;
      return this.toContribution(provider, placeId, {
        name: hit.placeName ?? undefined,
        placeFias: hit.placeFias ?? undefined,
        lat: hit.lat,
        lon: hit.lon,
        payload: hit.raw,
      });
    }

    if (provider === "nominatim") {
      const hit = await this.nominatim.enrich({
        rawText: query,
        regionCode,
        countryCode: nominatimHints?.countryCode,
        viewbox: nominatimHints?.viewbox,
      });
      if (!hit) return null;
      return this.toContribution(provider, placeId, {
        lat: hit.lat,
        lon: hit.lon,
        payload: hit.raw,
      });
    }

    const llmResult = await this.llm.enrich({ rawText: query, regionCode });
    if (!llmResult.ok) return null;
    const llm = llmResult.data;
    const best = llm.places?.[0];
    if (!best) return null;
    return this.toContribution(provider, placeId, {
      name: best.placeName,
      placeFias: best.placeFias ?? undefined,
      confidence: best.confidence ?? llm.confidence,
      payload: {
        model: llm.model,
        latencyMs: llm.latencyMs,
        best,
      },
    });
  }

  /**
   * Domain eval одного claimed job — без mark (UnifiedRunner закрывает через IWorkQueue).
   */
  async processClaimedJob(
    provider: PlaceEnrichmentProvider,
    job: PlaceEnrichmentJobRecord,
  ): Promise<WorkItemResult> {
    if (this.isDadataSuggestionsBlocked(provider)) {
      return { outcome: "skipped", detail: "dadata_blocked" };
    }
    try {
      const place = await this.places.findById(job.placeId);
      if (!place || place.kind === "region") {
        return { outcome: "skipped", detail: "skip_region" };
      }
      if (!isGeoEnrichEligibleKind(place.kind)) {
        return { outcome: "skipped", detail: "kind_below_city" };
      }
      const region = (await this.regions.listActive()).find((r) => r.id === place.regionId);
      if (!region) {
        return { outcome: "failed", detail: `${provider}: region not found` };
      }
      if (isGarbageIngestPlaceName(place.name)) {
        return { outcome: "skipped", detail: "non_geocodable" };
      }
      const regionCode = canonicalRegionCode(region);
      const parent = place.parentPlaceId ? await this.places.findById(place.parentPlaceId) : undefined;
      const placeLabel = normalizePlaceLabelForGeocode(place.name);
      const query = buildCatalogPlaceGeocodeQuery({
        placeName: placeLabel,
        placeNameWithType: place.nameWithType
          ? normalizePlaceLabelForGeocode(place.nameWithType)
          : undefined,
        region,
        parentPlaceName: parent?.name,
        parentPlaceNameWithType: parent?.nameWithType,
      });
      const nominatimHints =
        provider === "nominatim"
          ? {
              countryCode: resolveNominatimCountryCode(region.iso),
              viewbox: parseRegionViewbox(region.bbox),
            }
          : undefined;
      const contribution = await this.buildContribution(
        provider,
        place.id,
        query,
        regionCode,
        nominatimHints,
      );
      if (!contribution) {
        if (this.isDadataSuggestionsBlocked(provider)) {
          return { outcome: "skipped", detail: "dadata_blocked" };
        }
        return { outcome: "failed", detail: enrichmentMissError(provider) };
      }
      const applied = await this.applyContribution(place.id, provider, contribution);
      if (!applied.ok) {
        return { outcome: "failed", detail: applied.reason };
      }
      if (contribution.fields.name) {
        await this.aliases.upsertAlias({
          placeId: place.id,
          alias: contribution.fields.name,
          source: "auto",
        });
      }
      return { outcome: "completed" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { outcome: "failed", detail: message };
    }
  }

  private toContribution(
    provider: PlaceEnrichmentProvider,
    placeId: string,
    payload: {
      name?: string;
      placeFias?: string;
      lat?: number;
      lon?: number;
      confidence?: number;
      payload?: Record<string, unknown>;
    },
  ): PlaceContribution {
    const trustScore = payload.confidence ?? PROVIDER_SCORE[provider];
    const trust = toTrust(trustScore);
    return {
      placeId,
      provider,
      confidence: payload.confidence,
      trustState: trust.trustState,
      isTrusted: trust.isTrusted,
      trustScore,
      fields: {
        ...(payload.name ? { name: payload.name } : {}),
        ...(payload.placeFias ? { fiasId: payload.placeFias } : {}),
        ...(payload.lat != null ? { centroidLat: payload.lat } : {}),
        ...(payload.lon != null ? { centroidLon: payload.lon } : {}),
      },
      rawPayload: payload.payload,
    };
  }
}
