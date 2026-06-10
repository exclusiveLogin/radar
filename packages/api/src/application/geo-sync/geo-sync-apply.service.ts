import type {
  AliasDraft,
  GeoProviderSnapshot,
  IDomainEventRepository,
  IGeoSourceProvider,
  IPlaceAliasRepository,
  IPlaceRepository,
  IRegionRepository,
  PlaceDraft,
  ISyncAuditRepository,
  PlaceAliasRecord,
  PlaceRecord,
  RegionRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import { normalizeName, placeDraftKey } from "./diff-engine";
import {
  alignRegionRowsWithExisting,
  buildRegionIndexForSnapshot,
  resolveRegionFromIndex,
} from "./geo-sync-region-index";
import { runGeoSyncPersist } from "./geo-sync-persist.runner";
import type { GeoSyncApplyRunOptions } from "./geo-sync.reporter.port";
import type { GeoSyncPlan, GeoSyncPlanService } from "./geo-sync-plan.service";

/** Фактическая запись snapshot vs plan (plan может завышать после wipe). */
export type GeoSyncApplyPersistStats = {
  snapshotPlaces: number;
  placeRowsBuilt: number;
  unresolvedPlaceDrafts: number;
  regionRows: number;
};

export type GeoSyncApplyResult = {
  plan: GeoSyncPlan;
  persist: GeoSyncApplyPersistStats;
};

export class GeoSyncApplyService {
  constructor(
    private readonly provider: IGeoSourceProvider,
    private readonly regions: IRegionRepository,
    private readonly places: IPlaceRepository,
    private readonly aliases: IPlaceAliasRepository,
    private readonly audit: ISyncAuditRepository,
    private readonly events: IDomainEventRepository,
    private readonly planner: GeoSyncPlanService,
  ) {}

  /** Maps region draft into persistence record enriched with revision metadata. */
  private toRegionRecord(
    draft: Awaited<ReturnType<IGeoSourceProvider["loadSnapshot"]>>["regions"][number],
    sourceRevision: string,
  ): RegionRecord {
    return {
      id: randomUUID(),
      code: draft.fiasId ?? draft.iso ?? draft.name,
      fiasId: draft.fiasId,
      kladrId: draft.kladrId,
      iso: draft.iso,
      name: draft.name,
      nameWithType: draft.nameWithType,
      shortName: draft.shortName,
      federalDistrict: draft.federalDistrict,
      geometryArtifactKey: draft.geometryArtifactKey,
      centroidLat: draft.centroidLat,
      centroidLon: draft.centroidLon,
      sourceMeta: draft.sourceMeta,
      lastSourceRevision: sourceRevision,
      frontRegion: draft.frontRegion,
      borderRegion: draft.borderRegion,
    };
  }

  /** Maps place draft into persistence record bound to region id. */
  private toPlaceRecord(options: {
    draft: PlaceDraft;
    sourceRevision: string;
    regionId: string;
  }): PlaceRecord {
    const { draft, sourceRevision, regionId } = options;
    return {
      id: randomUUID(),
      regionId,
      kind: draft.kind,
      name: draft.name,
      nameWithType: draft.nameWithType,
      parentPlaceId: undefined,
      fiasId: draft.fiasId,
      kladrId: draft.kladrId,
      oktmo: draft.oktmo,
      geometryArtifactKey: draft.geometryArtifactKey,
      centroidLat: draft.centroidLat,
      centroidLon: draft.centroidLon,
      sourceMeta: draft.sourceMeta,
      lastSourceRevision: sourceRevision,
      trustState: "verified",
      isTrusted: true,
      trustScore: 1,
      evidenceProviders: ["catalog"],
    };
  }

  /** Builds lookup maps for persisted places by FIAS and natural key. */
  private buildPlaceIndex(places: PlaceRecord[]): {
    placeByFias: Map<string, PlaceRecord>;
    placeByNaturalKey: Map<string, PlaceRecord>;
  } {
    const placeByFias = new Map<string, PlaceRecord>();
    const placeByNaturalKey = new Map<string, PlaceRecord>();
    for (const place of places) {
      if (place.fiasId) {
        placeByFias.set(place.fiasId, place);
      }
      placeByNaturalKey.set(
        `${place.regionId}:${place.kind}:${normalizeName(place.name)}`,
        place,
      );
    }
    return { placeByFias, placeByNaturalKey };
  }

  /** Links provider place drafts with persisted place records by external key. */
  private linkPlacesByExternalKey(options: {
    drafts: PlaceDraft[];
    regionByExternalKey: Map<string, RegionRecord>;
    placeByFias: Map<string, PlaceRecord>;
    placeByNaturalKey: Map<string, PlaceRecord>;
  }): Map<string, PlaceRecord> {
    const {
      drafts,
      regionByExternalKey,
      placeByFias,
      placeByNaturalKey,
    } = options;
    const placeByExternalKey = new Map<string, PlaceRecord>();
    for (const draft of drafts) {
      const region = resolveRegionFromIndex(regionByExternalKey, draft.regionCode);
      if (!region) continue;
      const persistedPlace = draft.fiasId
        ? placeByFias.get(draft.fiasId)
        : placeByNaturalKey.get(
            `${region.id}:${draft.kind}:${normalizeName(draft.name)}`,
          );
      if (!persistedPlace) continue;
      placeByExternalKey.set(placeDraftKey(draft), persistedPlace);
    }
    return placeByExternalKey;
  }

  /** Builds final alias rows (provider aliases + auto aliases from place drafts). */
  private buildAliasRows(options: {
    aliases: AliasDraft[];
    placeDrafts: PlaceDraft[];
    regionByExternalKey: Map<string, RegionRecord>;
    regionPlaceByRegionId: Map<string, string>;
    placeByExternalKey: Map<string, PlaceRecord>;
  }): PlaceAliasRecord[] {
    const aliasRows: PlaceAliasRecord[] = [];
    const pushAlias = (aliasDraft: AliasDraft): void => {
      const aliasNormalized = normalizeName(aliasDraft.alias);
      if (!aliasNormalized) return;

      let placeId: string | undefined;
      if (aliasDraft.targetKind === "region") {
        const region = resolveRegionFromIndex(
          options.regionByExternalKey,
          aliasDraft.targetExternalKey,
        );
        placeId = region ? options.regionPlaceByRegionId.get(region.id) : undefined;
      } else {
        placeId = options.placeByExternalKey.get(aliasDraft.targetExternalKey)?.id;
      }
      if (!placeId) return;

      aliasRows.push({
        id: randomUUID(),
        placeId,
        alias: aliasDraft.alias,
        aliasNormalized,
        source: aliasDraft.source,
      });
    };

    for (const alias of options.aliases) {
      pushAlias(alias);
    }
    for (const draft of options.placeDrafts) {
      const externalKey = placeDraftKey(draft);
      if (!options.placeByExternalKey.has(externalKey)) continue;
      pushAlias({
        targetKind: "place",
        targetExternalKey: externalKey,
        alias: draft.name,
        source: "auto",
      });
      if (draft.nameWithType) {
        pushAlias({
          targetKind: "place",
          targetExternalKey: externalKey,
          alias: draft.nameWithType,
          source: "auto",
        });
      }
      for (const alias of draft.aliases ?? []) {
        pushAlias({
          targetKind: "place",
          targetExternalKey: externalKey,
          alias,
          source: "auto",
        });
      }
    }
    return aliasRows;
  }

  private buildPlaceRows(
    snapshot: Awaited<ReturnType<IGeoSourceProvider["loadSnapshot"]>>,
    regionByExternalKey: Map<string, RegionRecord>,
  ): PlaceRecord[] {
    return snapshot.places
      .map((draft) => {
        const region = resolveRegionFromIndex(regionByExternalKey, draft.regionCode);
        if (!region) return undefined;
        return this.toPlaceRecord({
          draft,
          sourceRevision: snapshot.sourceRevision,
          regionId: region.id,
        });
      })
      .filter((row): row is PlaceRecord => Boolean(row));
  }

  /** Applies sync plan: persists regions/places/aliases and emits audit/events. */
  async apply(
    options?: GeoSyncApplyRunOptions & { providerSnapshot?: GeoProviderSnapshot },
  ): Promise<GeoSyncApplyResult> {
    const snapshot = options?.providerSnapshot ?? await this.provider.loadSnapshot();
    if (!options?.providerSnapshot) {
      options?.snapshot?.snapshotLoaded();
    }

    const auditRow = await this.audit.start({
      target: "all",
      sourceId: snapshot.sourceId,
      sourceRevision: snapshot.sourceRevision,
    });
    const plan = await this.planner.plan({ skipSnapshot: true, snapshot });

    try {
      const existingRegions = await this.regions.listActive();
      const regionRows = alignRegionRowsWithExisting(
        snapshot.regions.map((draft) =>
          this.toRegionRecord(draft, snapshot.sourceRevision),
        ),
        existingRegions,
      );
      const regionByExternalKey = buildRegionIndexForSnapshot(existingRegions, regionRows);
      const placeRows = this.buildPlaceRows(snapshot, regionByExternalKey);
      const unresolvedPlaceDrafts = snapshot.places.length - placeRows.length;

      await runGeoSyncPersist({
        regions: this.regions,
        places: this.places,
        aliases: this.aliases,
        regionRows,
        placeRows,
        reporter: options?.persist,
        resolveAliasRows: async (regionPlaceByRegionId) => {
          const { placeByFias, placeByNaturalKey } = this.buildPlaceIndex(
            await this.places.listActive(),
          );
          const placeByExternalKey = this.linkPlacesByExternalKey({
            drafts: snapshot.places,
            regionByExternalKey,
            placeByFias,
            placeByNaturalKey,
          });
          return this.buildAliasRows({
            aliases: snapshot.aliases,
            placeDrafts: snapshot.places,
            regionByExternalKey,
            regionPlaceByRegionId,
            placeByExternalKey,
          });
        },
      });

      await this.audit.finish(auditRow.id, {
        status: "ok",
        counts: {
          region: plan.region,
          place: plan.place,
          alias: plan.alias,
        },
        diffSample: plan.sample,
      });

      await this.events.append([
        {
          id: randomUUID(),
          type: "GeoSyncCompleted",
          version: 1,
          occurredAt: new Date().toISOString(),
          aggregateType: "geo_sync",
          aggregateId: auditRow.id,
          payload: {
            sourceId: snapshot.sourceId,
            sourceRevision: snapshot.sourceRevision,
            counts: {
              region: plan.region,
              place: plan.place,
              alias: plan.alias,
            },
          },
        },
      ]);

      return {
        plan,
        persist: {
          snapshotPlaces: snapshot.places.length,
          placeRowsBuilt: placeRows.length,
          unresolvedPlaceDrafts,
          regionRows: regionRows.length,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.audit.finish(auditRow.id, {
        status: "failed",
        errors: { message },
      });
      await this.events.append([
        {
          id: randomUUID(),
          type: "GeoSyncFailed",
          version: 1,
          occurredAt: new Date().toISOString(),
          aggregateType: "geo_sync",
          aggregateId: auditRow.id,
          payload: { message },
        },
      ]);
      throw error;
    }
  }
}
