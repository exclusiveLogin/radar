/**
 * Type-only public barrel for domain ports.
 * Runtime exports are intentionally absent.
 */
export type { IGeoSourceProvider, GeoProviderSnapshot } from "./providers";
export type { ILocationEnricher, LocationCandidate } from "./enrichers";
export type { IEventClassifier, ClassifiedPost } from "./classifiers";
export type { EventHandler, IEventPublisher, IEventSubscriber, Unsubscribe } from "./events";
export type {
  IDomainEventRepository,
  IEventLocationRepository,
  IIngestCursorRepository,
  IParsedEventRepository,
  IPlaceAliasRepository,
  IPlaceCacheRepository,
  IPlaceEvidenceRepository,
  IPlaceRepository,
  IPlaceStatusHistoryRepository,
  IPlaceStatusRepository,
  IRawMessageRepository,
  IRegionRepository,
  IStatusDictionaryRepository,
  ISyncAuditRepository,
  PlaceStatusActiveRecord,
  PlaceStatusHistoryRecord,
  PlaceAliasRecord,
  PlaceContribution,
  PlaceEvidenceRecord,
  PlaceProvider,
  PlaceRecord,
  RegionRecord,
  StatusDictionaryRecord,
} from "./repositories";
