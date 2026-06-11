import { Injectable } from "@nestjs/common";
import type {
  MapPlaceSnapshot,
  MapRegionSnapshot,
  PlaceStateEvent,
  StateLevel,
  WsServerMessage,
} from "@radar/shared";
import { loadLayout } from "./layout.loader";
import { MapStateFoldService } from "./map-state-fold.service";

type Emit = (message: WsServerMessage) => void;

const WARNING_TITLES: Record<string, string> = {
  grey: "Нет данных",
  green: "Отбой",
  yellow: "Внимание",
  orange: "Повышенная опасность",
  red: "Опасность",
};

/**
 * WS realtime при RADAR_MAP_READ_SOURCE=fold: diff snapshot(now) раз в pollMs.
 * Клиент при connect получает полный snapshot; poller шлёт только дельты.
 */
@Injectable()
export class MapFoldRealtimePoller {
  private timer: NodeJS.Timeout | null = null;
  private readonly pollMs = 1000;
  private primed = false;
  private lastRegions = new Map<string, MapRegionSnapshot>();
  private lastPlaces = new Map<string, MapPlaceSnapshot>();

  constructor(private readonly mapStateFold: MapStateFoldService) {}

  start(emit: Emit): void {
    if (this.timer) return;
    this.primed = false;
    this.lastRegions = new Map();
    this.lastPlaces = new Map();
    this.timer = setInterval(() => void this.tick(emit), this.pollMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(emit: Emit): Promise<void> {
    const snapshot = await this.mapStateFold.getSnapshotAt(new Date());
    const nextRegions = new Map(snapshot.regions.map((region) => [region.regionId, region]));
    const nextPlaces = new Map(snapshot.places.map((place) => [place.placeId, place]));

    if (!this.primed) {
      this.lastRegions = nextRegions;
      this.lastPlaces = nextPlaces;
      this.primed = true;
      return;
    }

    const layoutTiles = loadLayout().tiles;
    const atIso = snapshot.generatedAt;

    for (const [regionId, region] of nextRegions) {
      const prev = this.lastRegions.get(regionId);
      if (
        prev
        && prev.stateLevel === region.stateLevel
        && prev.statusEventAt === region.statusEventAt
        && prev.statusAction === region.statusAction
      ) {
        continue;
      }

      emit({
        type: "region-state",
        payload: {
          regionId,
          regionCode: region.regionCode,
          stateLevel: region.stateLevel,
          previousLevel: prev?.stateLevel ?? "grey",
          activity: region.activity ?? 0,
          reason: undefined,
          changedAt: region.statusEventAt ?? atIso,
          statusEventAt: region.statusEventAt,
          statusAction: region.statusAction,
          centroidLat: region.centroidLat,
          centroidLon: region.centroidLon,
          layout: region.layout ?? layoutTiles[region.regionCode],
        },
      });

      if (region.stateLevel !== "grey") {
        emit({
          type: "warning",
          payload: {
            id: `${regionId}:${region.statusEventAt ?? atIso}`,
            regionId,
            regionCode: region.regionCode,
            regionName: region.name,
            title: WARNING_TITLES[region.stateLevel] ?? region.stateLevel,
            stateLevel: region.stateLevel,
            eventAt: region.statusEventAt ?? atIso,
          },
        });
      }
    }

    for (const [regionId, prev] of this.lastRegions) {
      if (nextRegions.has(regionId)) continue;
      emit({
        type: "region-state",
        payload: {
          regionId,
          regionCode: prev.regionCode,
          stateLevel: "grey",
          previousLevel: prev.stateLevel,
          activity: 0,
          changedAt: prev.statusEventAt ?? atIso,
          statusEventAt: prev.statusEventAt,
          statusAction: prev.statusAction,
          centroidLat: prev.centroidLat,
          centroidLon: prev.centroidLon,
          layout: prev.layout ?? layoutTiles[prev.regionCode],
        },
      });
    }

    for (const [placeId, place] of nextPlaces) {
      const prev = this.lastPlaces.get(placeId);
      if (
        prev
        && prev.stateLevel === place.stateLevel
        && prev.statusEventAt === place.statusEventAt
        && prev.statusCode === place.statusCode
      ) {
        continue;
      }
      emit({
        type: "place-state",
        payload: this.toPlaceStateEvent(place, "activate"),
      });
    }

    for (const [placeId, prev] of this.lastPlaces) {
      if (nextPlaces.has(placeId)) continue;
      emit({
        type: "place-state",
        payload: this.toPlaceStateEvent(prev, "deactivate"),
      });
    }

    this.lastRegions = nextRegions;
    this.lastPlaces = nextPlaces;
  }

  private toPlaceStateEvent(
    place: MapPlaceSnapshot,
    action: PlaceStateEvent["action"],
  ): PlaceStateEvent {
    return {
      placeId: place.placeId,
      placeName: place.placeName,
      regionId: place.regionId,
      regionCode: place.regionCode,
      statusCode: place.statusCode,
      stateLevel: place.stateLevel as StateLevel,
      action,
      kind: place.kind,
      geoFeatureId: place.geoFeatureId,
      lat: place.lat,
      lon: place.lon,
      changedAt: place.statusEventAt ?? place.updatedAt,
    };
  }
}
