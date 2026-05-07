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

  async apply(): Promise<Awaited<ReturnType<GeoSyncPlanService["plan"]>>> {
    const snapshot = await this.provider.loadSnapshot();
    const auditRow = await this.audit.start({
      target: "all",
      sourceId: snapshot.sourceId,
      sourceRevision: snapshot.sourceRevision,
    });

    const plan = await this.planner.plan();
    try {
      const regionByExternalKey = new Map<string, RegionRecord>();
      const regionRows: RegionRecord[] = snapshot.regions.map((row) => ({
        id: randomUUID(),
        code: row.fiasId ?? row.iso ?? row.name,
        fiasId: row.fiasId,
        kladrId: row.kladrId,
        iso: row.iso,
        name: row.name,
        nameWithType: row.nameWithType,
        shortName: row.shortName,
        federalDistrict: row.federalDistrict,
        geometryArtifactKey: row.geometryArtifactKey,
        sourceMeta: row.sourceMeta,
        lastSourceRevision: snapshot.sourceRevision,
        frontRegion: row.frontRegion,
        borderRegion: row.borderRegion,
      }));
      await this.regions.upsertMany(regionRows);
      const activeRegions = await this.regions.listActive();

      for (const region of activeRegions) {
        const keys = new Set<string>();
        keys.add(region.id);
        keys.add(region.code);
        if (region.fiasId) keys.add(region.fiasId);
        if (region.kladrId) keys.add(region.kladrId);
        if (region.iso) keys.add(region.iso);
        keys.add(normalizeName(region.name));
        if (region.nameWithType) keys.add(normalizeName(region.nameWithType));
        for (const key of keys) {
          regionByExternalKey.set(key, region);
        }
      }

      const placeRows: PlaceRecord[] = [];
      for (const draft of snapshot.places) {
        const region = regionByExternalKey.get(draft.regionCode) ??
          regionByExternalKey.get(normalizeName(draft.regionCode));
        if (!region) continue;
        const place: PlaceRecord = {
          id: randomUUID(),
          regionId: region.id,
          kind: draft.kind,
          name: draft.name,
          nameWithType: draft.nameWithType,
          parentPlaceId: undefined,
          fiasId: draft.fiasId,
          kladrId: draft.kladrId,
          oktmo: draft.oktmo,
          geometryArtifactKey: draft.geometryArtifactKey,
          sourceMeta: draft.sourceMeta,
          lastSourceRevision: snapshot.sourceRevision,
        };
        placeRows.push(place);
      }
      await this.places.upsertMany(placeRows);
      const activePlaces = await this.places.listActive();
      const placeByExternalKey = new Map<string, PlaceRecord>();
      const placeByFias = new Map<string, PlaceRecord>();
      const placeByNaturalKey = new Map<string, PlaceRecord>();
      for (const row of activePlaces) {
        if (row.fiasId) {
          placeByFias.set(row.fiasId, row);
        }
        placeByNaturalKey.set(
          `${row.regionId}:${row.kind}:${normalizeName(row.name)}`,
          row,
        );
      }
      for (const draft of snapshot.places) {
        const region = regionByExternalKey.get(draft.regionCode) ??
          regionByExternalKey.get(normalizeName(draft.regionCode));
        if (!region) continue;
        const persistedPlace = draft.fiasId
          ? placeByFias.get(draft.fiasId)
          : placeByNaturalKey.get(
              `${region.id}:${draft.kind}:${normalizeName(draft.name)}`,
            );
        if (!persistedPlace) continue;
        placeByExternalKey.set(placeDraftKey(draft), persistedPlace);
      }

      const aliasRows: PlaceAliasRecord[] = [];
      const pushAlias = (aliasDraft: AliasDraft): void => {
        const normalized = normalizeName(aliasDraft.alias);
        if (!normalized) return;
        if (aliasDraft.targetKind === "region") {
          const region = regionByExternalKey.get(aliasDraft.targetExternalKey) ??
            regionByExternalKey.get(normalizeName(aliasDraft.targetExternalKey));
          if (!region) return;
          aliasRows.push({
            id: randomUUID(),
            alias: aliasDraft.alias,
            aliasNormalized: normalized,
            targetKind: "region",
            regionId: region.id,
            source: aliasDraft.source,
          });
          return;
        }
        const place = placeByExternalKey.get(aliasDraft.targetExternalKey);
        if (!place) return;
        aliasRows.push({
          id: randomUUID(),
          alias: aliasDraft.alias,
          aliasNormalized: normalized,
          targetKind: "place",
          placeId: place.id,
          source: aliasDraft.source,
        });
      };

      for (const alias of snapshot.aliases) {
        pushAlias(alias);
      }

      // Авто-алиасы из places (включая дополнительные алиасы из draft).
      for (const draft of snapshot.places) {
        const externalKey = placeDraftKey(draft);
        const place = placeByExternalKey.get(externalKey);
        if (!place) continue;
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
