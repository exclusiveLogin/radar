import type { DataSource } from "typeorm";
import type { GeoSyncPersistenceDeps } from "../../application/geo-sync/geo-sync-persistence-deps.port";
import { TypeOrmDomainEventRepository } from "@radar/persistence";
import { TypeOrmPlaceAliasRepository } from "@radar/persistence";
import { TypeOrmPlaceRepository } from "@radar/persistence";
import { TypeOrmRegionRepository } from "@radar/persistence";
import { TypeOrmSyncAuditRepository } from "@radar/persistence";

/** Собирает согласованный комплект TypeORM-адаптеров полного geo-sync. */
export function createGeoSyncPersistenceDeps(dataSource: DataSource): GeoSyncPersistenceDeps {
  return {
    regions: new TypeOrmRegionRepository(dataSource),
    places: new TypeOrmPlaceRepository(dataSource),
    aliases: new TypeOrmPlaceAliasRepository(dataSource),
    audit: new TypeOrmSyncAuditRepository(dataSource),
    events: new TypeOrmDomainEventRepository(dataSource),
  };
}
