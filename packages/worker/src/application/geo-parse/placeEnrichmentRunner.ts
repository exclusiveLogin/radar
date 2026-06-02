import { canonicalRegionCode, type IPlaceAliasRepository, type IPlaceEnrichmentJobRepository, type IPlaceRepository, type IRegionRepository, type PlaceContribution, type PlaceEnrichmentProvider } from "@radar/shared";
import { DadataEnricher } from "../../infrastructure/enrichers/dadataEnricher.js";
import { loadDadataToken } from "../../infrastructure/enrichers/dadataConfig.js";
import { LlmEnricher } from "../../infrastructure/enrichers/llmEnricher.js";
import { loadLlmRuntimeConfig } from "../../infrastructure/enrichers/llmRuntimeConfig.js";
import { NominatimEnricher } from "../../infrastructure/enrichers/nominatimEnricher.js";
import { syncPlaceGeoQueueForProvider } from "./placeGeoQueueSync.js";
import {
  logGeoBatchSummary,
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
  private dadataEnricher: DadataEnricher | undefined;
  private readonly nominatim = new NominatimEnricher();
  private readonly llm = new LlmEnricher(loadLlmRuntimeConfig());

  constructor(
    private readonly jobs: IPlaceEnrichmentJobRepository,
    private readonly places: IPlaceRepository,
    private readonly aliases: IPlaceAliasRepository,
    private readonly regions: IRegionRepository,
  ) {}

  /** Токен из .env после loadRootEnv (не при импорте модуля). */
  private getDadata(): DadataEnricher {
    if (!this.dadataEnricher) {
      this.dadataEnricher = new DadataEnricher(loadDadataToken());
    }
    return this.dadataEnricher;
  }

  private isDadataSuggestionsBlocked(provider: PlaceEnrichmentProvider): boolean {
    return provider === "dadata" && this.getDadata().isSuggestionsBlocked();
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

  /** merge + проверка: job done только если провайдер попал в evidence_providers. */
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
    const after = await this.places.findById(placeId);
    if (!after?.evidenceProviders?.includes(provider)) {
      return { ok: false, reason: `${provider}: evidence_providers не обновлён после merge` };
    }
    return { ok: true };
  }

  async runBatch(
    provider: PlaceEnrichmentProvider,
    limit: number,
    logContext?: { phaseId?: string },
  ): Promise<{ claimed: number; processed: number; failed: number }> {
    if (this.isDadataSuggestionsBlocked(provider)) {
      return { claimed: 0, processed: 0, failed: 0 };
    }

    const catchUpEnqueued = await syncPlaceGeoQueueForProvider(this.jobs, provider);
    const claimed = await this.jobs.claimBatch(provider, limit);
    if (claimed.length === 0) {
      if (catchUpEnqueued > 0) {
        logGeoBatchSummary({
          phaseId: logContext?.phaseId,
          provider,
          claimed: 0,
          processed: 0,
          failed: 0,
          catchUpEnqueued,
        });
      }
      return { claimed: 0, processed: 0, failed: 0 };
    }

    const regionsById = new Map((await this.regions.listActive()).map((row) => [row.id, row]));
    let processed = 0;
    let failed = 0;

    for (let i = 0; i < claimed.length; i += 1) {
      const job = claimed[i]!;
      try {
        const place = await this.places.findById(job.placeId);
        if (!place || place.kind === "region") {
          logGeoPlaceVerbose({
            provider,
            placeId: job.placeId,
            placeName: place?.name ?? job.placeId,
            query: "",
            outcome: "skip_region",
          });
          await this.jobs.markDone(job.id);
          processed += 1;
          continue;
        }
        const region = regionsById.get(place.regionId);
        const regionCode = region ? canonicalRegionCode(region) : undefined;
        const query = [place.nameWithType ?? place.name, region?.name].filter(Boolean).join(", ");

        const contribution = await this.buildContribution(provider, place.id, query, regionCode);
        if (!contribution) {
          if (this.isDadataSuggestionsBlocked(provider)) {
            await this.abortBatchOnDadataBlocked(claimed, i);
            break;
          }
          logGeoPlaceVerbose({
            provider,
            placeId: place.id,
            placeName: place.name,
            query,
            outcome: "no_hit",
          });
          await this.jobs.markFailed(job.id, `${provider}: no enrichment result`);
          failed += 1;
          continue;
        }
        const applied = await this.applyContribution(place.id, provider, contribution);
        if (!applied.ok) {
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
      catchUpEnqueued,
    });
    return { claimed: claimed.length, processed, failed };
  }

  async runDrain(provider: PlaceEnrichmentProvider, batchSize: number): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    for (;;) {
      const batch = await this.runBatch(provider, batchSize);
      processed += batch.processed;
      failed += batch.failed;
      if (batch.claimed === 0) break;
    }
    return { processed, failed };
  }

  private async buildContribution(
    provider: PlaceEnrichmentProvider,
    placeId: string,
    query: string,
    regionCode: string | undefined,
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
      const hit = await this.nominatim.enrich({ rawText: query, regionCode });
      if (!hit) return null;
      return this.toContribution(provider, placeId, {
        lat: hit.lat,
        lon: hit.lon,
        payload: hit.raw,
      });
    }

    const llm = await this.llm.enrich({ rawText: query, regionCode });
    const best = llm?.places?.[0];
    if (!llm || !best) return null;
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
