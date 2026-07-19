import type {
  IDomainEventRepository,
  IPlaceAliasRepository,
  IPlaceRepository,
  IRegionRepository,
  ISyncAuditRepository,
} from "@radar/shared";

/** Полный набор хранилищ, требуемый для планирования и применения geo-sync. */
export type GeoSyncPersistenceDeps = {
  regions: IRegionRepository;
  places: IPlaceRepository;
  aliases: IPlaceAliasRepository;
  audit: ISyncAuditRepository;
  events: IDomainEventRepository;
};
