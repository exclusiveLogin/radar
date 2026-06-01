import type {
  IRegionStateRepository,
  RegionStateActiveRecord,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  RegionStateActiveEntity,
  RegionStateHistoryEntity,
} from "../../events/entities";

export class TypeOrmRegionStateRepository implements IRegionStateRepository {
  constructor(private readonly dataSource: DataSource) {}

  async upsert(input: RegionStateActiveRecord): Promise<void> {
    const repo = this.dataSource.getRepository(RegionStateActiveEntity);
    await repo.save(
      repo.create({
        regionId: input.regionId,
        regionCode: input.regionCode,
        stateLevel: input.stateLevel,
        selfLevel: input.selfLevel,
        activity: input.activity,
        reason: input.reason ?? null,
        updatedAt: new Date(input.updatedAt),
        statusEventAt: input.statusEventAt ? new Date(input.statusEventAt) : null,
      }),
    );
  }

  async get(regionId: string): Promise<RegionStateActiveRecord | null> {
    const row = await this.dataSource
      .getRepository(RegionStateActiveEntity)
      .findOne({ where: { regionId } });
    return row ? this.toRecord(row) : null;
  }

  async listAll(): Promise<RegionStateActiveRecord[]> {
    const rows = await this.dataSource
      .getRepository(RegionStateActiveEntity)
      .find();
    return rows.map((row) => this.toRecord(row));
  }

  async listAlarmUpdatedBefore(
    updatedBeforeIso: string,
  ): Promise<RegionStateActiveRecord[]> {
    const cutoff = new Date(updatedBeforeIso);
    const rows = await this.dataSource
      .getRepository(RegionStateActiveEntity)
      .createQueryBuilder("rsa")
      .where("rsa.state_level <> :grey", { grey: "grey" })
      .andWhere(
        `(rsa.status_event_at IS NOT NULL AND rsa.status_event_at < :cutoff)
         OR (rsa.status_event_at IS NULL AND rsa.updated_at < :cutoff)`,
        { cutoff },
      )
      .getMany();
    return rows.map((row) => this.toRecord(row));
  }

  async appendHistory(input: {
    regionId: string;
    regionCode: string;
    stateLevel: RegionStateActiveRecord["stateLevel"];
    previousLevel: RegionStateActiveRecord["stateLevel"];
    reason?: string;
    changedAt: string;
  }): Promise<void> {
    const repo = this.dataSource.getRepository(RegionStateHistoryEntity);
    await repo.save(
      repo.create({
        regionId: input.regionId,
        regionCode: input.regionCode,
        stateLevel: input.stateLevel,
        previousLevel: input.previousLevel,
        reason: input.reason ?? null,
        changedAt: new Date(input.changedAt),
      }),
    );
  }

  private toRecord(row: RegionStateActiveEntity): RegionStateActiveRecord {
    return {
      regionId: row.regionId,
      regionCode: row.regionCode,
      stateLevel: row.stateLevel,
      selfLevel: row.selfLevel,
      activity: row.activity,
      reason: row.reason ?? undefined,
      updatedAt: row.updatedAt.toISOString(),
      statusEventAt: row.statusEventAt?.toISOString() ?? null,
    };
  }
}
