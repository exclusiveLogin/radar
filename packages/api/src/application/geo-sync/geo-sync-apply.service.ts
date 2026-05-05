import type {
  IDomainEventRepository,
  IGeoSourceProvider,
  IPlaceAliasRepository,
  IPlaceRepository,
  IRegionRepository,
  ISyncAuditRepository,
  PlaceAliasRecord,
  PlaceRecord,
  RegionRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
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
      const regionRows: RegionRecord[] = snapshot.regions.map((row) => ({
        id: randomUUID(),
        code: row.fiasId ?? row.iso ?? row.name,
        fiasId: row.fiasId,
        name: row.name,
        frontRegion: row.frontRegion,
        borderRegion: row.borderRegion,
      }));
      const placeRows: PlaceRecord[] = [];
      const aliasRows: PlaceAliasRecord[] = [];

      await this.regions.upsertMany(regionRows);
      await this.places.upsertMany(placeRows);
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
