import type {
  AliasDraft,
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
import { GeoSyncPlanService } from "./geo-sync-plan.service";

export class GeoSyncApplyService {
  private readonly planner: GeoSyncPlanService;

  constructor(
    private readonly provider: IGeoSourceProvider,
    private readonly regions: IRegionRepository,
    private readonly places: IPlaceRepository,
    private readonly aliases: IPlaceAliasRepository,
    private readonly audit: ISyncAuditRepository,
    private readonly events: IDomainEventRepository,
  ) {
    this.planner = new GeoSyncPlanService(provider, regions, places, aliases);
  }

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
      sourceMeta: draft.sourceMeta,
      lastSourceRevision: sourceRevision,
      frontRegion: draft.frontRegion,
      borderRegion: draft.borderRegion,
    };
  }

  /** Builds lookup index for region identifiers, codes and normalized names. */
  private buildRegionIndex(regions: RegionRecord[]): Map<string, RegionRecord> {
    const index = new Map<string, RegionRecord>();
    for (const region of regions) {
      const keys = new Set<string>([region.id, region.code, normalizeName(region.name)]);
      if (region.fiasId) keys.add(region.fiasId);
      if (region.kladrId) keys.add(region.kladrId);
      if (region.iso) keys.add(region.iso);
      if (region.nameWithType) keys.add(normalizeName(region.nameWithType));
      for (const key of keys) {
        index.set(key, region);
      }
    }
    return index;
  }

  /** Resolves region by external key or normalized fallback key. */
  private resolveRegion(
    index: Map<string, RegionRecord>,
    regionCode: string,
  ): RegionRecord | undefined {
    return index.get(regionCode) ?? index.get(normalizeName(regionCode));
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
      sourceMeta: draft.sourceMeta,
      lastSourceRevision: sourceRevision,
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
      const region = this.resolveRegion(regionByExternalKey, draft.regionCode);
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
    placeByExternalKey: Map<string, PlaceRecord>;
  }): PlaceAliasRecord[] {
    const aliasRows: PlaceAliasRecord[] = [];
    const pushAlias = (aliasDraft: AliasDraft): void => {
      const aliasNormalized = normalizeName(aliasDraft.alias);
      if (!aliasNormalized) return;
      if (aliasDraft.targetKind === "region") {
        const region = this.resolveRegion(
          options.regionByExternalKey,
          aliasDraft.targetExternalKey,
        );
        if (!region) return;
        aliasRows.push({
          id: randomUUID(),
          alias: aliasDraft.alias,
          aliasNormalized,
          targetKind: "region",
          regionId: region.id,
          source: aliasDraft.source,
        });
        return;
      }

      const place = options.placeByExternalKey.get(aliasDraft.targetExternalKey);
      if (!place) return;
      aliasRows.push({
        id: randomUUID(),
        alias: aliasDraft.alias,
        aliasNormalized,
        targetKind: "place",
        placeId: place.id,
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

  /** Applies sync plan: persists regions/places/aliases and emits audit/events. */
  async apply(): Promise<Awaited<ReturnType<GeoSyncPlanService["plan"]>>> {
    const snapshot = await this.provider.loadSnapshot();
    const auditRow = await this.audit.start({
      target: "all",
      sourceId: snapshot.sourceId,
      sourceRevision: snapshot.sourceRevision,
    });
    const plan = await this.planner.plan();

    try {
      const regionRows = snapshot.regions.map((draft) =>
        this.toRegionRecord(draft, snapshot.sourceRevision),
      );
      await this.regions.upsertMany(regionRows);
      const regionByExternalKey = this.buildRegionIndex(await this.regions.listActive());

      const placeRows = snapshot.places
        .map((draft) => {
          const region = this.resolveRegion(regionByExternalKey, draft.regionCode);
          if (!region) return undefined;
          return this.toPlaceRecord({
            draft,
            sourceRevision: snapshot.sourceRevision,
            regionId: region.id,
          });
        })
        .filter((row): row is PlaceRecord => Boolean(row));
      await this.places.upsertMany(placeRows);

      const { placeByFias, placeByNaturalKey } = this.buildPlaceIndex(
        await this.places.listActive(),
      );
      const placeByExternalKey = this.linkPlacesByExternalKey({
        drafts: snapshot.places,
        regionByExternalKey,
        placeByFias,
        placeByNaturalKey,
      });

      const aliasRows = this.buildAliasRows({
        aliases: snapshot.aliases,
        placeDrafts: snapshot.places,
        regionByExternalKey,
        placeByExternalKey,
      });
      await this.aliases.upsertMany(aliasRows);

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

      return plan;
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
