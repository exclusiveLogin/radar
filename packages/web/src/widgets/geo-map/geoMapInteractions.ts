import type { Map as MapLibreMap, MapLayerMouseEvent, Popup } from "maplibre-gl";
import { regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion } from "../../shared/state/selectionStore";
import { selectTrack, setLocusDebugFocus, tracksList$ } from "../../shared/state/trackStore";
import { geoMapLayers$ } from "../../shared/state/mapLayerStore";
import {
  DISTRICTS_FILL,
  DISTRICTS_OUTLINE,
  PLACES_LAYER,
  REGIONS_FILL,
  REGIONS_OUTLINE,
  TRACKS_LINES_DASHED_HIT_LAYER,
  TRACKS_LINES_DASHED_LAYER,
  TRACKS_LINES_HIT_LAYER,
  TRACKS_LINES_LAYER,
  TRACKS_LOCUS_SOURCE,
  TRACKS_ORIGIN_LAYER,
} from "./geoMapLayerIds";
import { buildPlacePopupLines, buildRegionPopupHtml, hasChildEntityAtPointer } from "./geoMapEngine";
import type { GeoMapRuntime } from "./geoMapRuntime";
import { tracksLocusDebugToGeoJson } from "./tracksLocusDebugGeoJson";
import type { GeoJsonCollection } from "./geoMapTypes";

type MapLibrePopupConstructor = new (options?: {
  closeButton?: boolean;
  closeOnClick?: boolean;
  className?: string;
  offset?: number;
}) => Popup;

export type GeoMapInteractionControllerDependencies = {
  getMap(): MapLibreMap | null;
  isDisposed(): boolean;
  popup: MapLibrePopupConstructor;
  runtime: GeoMapRuntime;
  getHighlightedRegionCode(): string | null;
};

/**
 * Обслуживает pointer-взаимодействия карты: выбор сущностей, hover-подсказки и debug-фокус трека.
 * Локальное состояние контроллера существует ровно столько же, сколько MapLibre-инстанс.
 */
export function createGeoMapInteractionController({
  getMap,
  isDisposed,
  popup: PopupConstructor,
  runtime,
  getHighlightedRegionCode,
}: GeoMapInteractionControllerDependencies) {
  let focusedTrackId: string | null = null;
  let hoveredTrackId: string | null = null;
  let placePopup: Popup | null = null;
  let regionPopup: Popup | null = null;
  let activePlacePopupId: string | null = null;
  let activeRegionPopupKey: string | null = null;

  const trackIdFromEvent = (event: MapLayerMouseEvent): string | null => {
    const trackId = event.features?.[0]?.properties?.trackId;
    return typeof trackId === "string" && trackId.length > 0 ? trackId : null;
  };

  const applyLocusFocus = (): void => {
    const map = getMap();
    if (!map || isDisposed() || !geoMapLayers$.value.locusDebug) return;
    runtime.sources.apply(
      TRACKS_LOCUS_SOURCE,
      tracksLocusDebugToGeoJson(tracksList$.value, {
        trackId: focusedTrackId ?? hoveredTrackId,
      }) as GeoJsonCollection,
    );
  };

  const showPlacePopup = (lngLat: MapLayerMouseEvent["lngLat"], placeId: string): void => {
    const map = getMap();
    if (!map) return;
    activePlacePopupId = placeId;
    activeRegionPopupKey = null;
    regionPopup?.remove();
    regionPopup = null;
    map.getCanvas().style.cursor = "pointer";

    const lines = buildPlacePopupLines(placeId);
    if (lines.length === 0) return;

    placePopup?.remove();
    placePopup = new PopupConstructor({
      closeButton: false,
      closeOnClick: false,
      className: "geo-map-place-popup",
      offset: 12,
    })
      .setLngLat(lngLat)
      .setText(lines.join("\n"))
      .addTo(map);

    void runtime.popups.resolvePlaceSource(placeId).then((sourceMessage) => {
      if (!getMap() || !placePopup || activePlacePopupId !== placeId) return;
      const enriched = buildPlacePopupLines(placeId, sourceMessage);
      if (enriched.length > 0) placePopup.setText(enriched.join("\n"));
    });
  };

  const showRegionPopup = (lngLat: MapLayerMouseEvent["lngLat"], code: string): void => {
    const map = getMap();
    if (!map) return;
    const region = regionsByCode$.value.get(code);
    const popupKey = `${code}:${region?.statusEventAt ?? ""}`;
    activeRegionPopupKey = popupKey;
    placePopup?.remove();
    placePopup = null;
    activePlacePopupId = null;
    map.getCanvas().style.cursor = "pointer";

    regionPopup?.remove();
    regionPopup = new PopupConstructor({
      closeButton: false,
      closeOnClick: false,
      className: "geo-map-region-popup",
      offset: 12,
    })
      .setLngLat(lngLat)
      .setHTML(buildRegionPopupHtml(code))
      .addTo(map);

    void runtime.popups.resolveRegionSource(code, region?.statusEventAt).then((sourceMessage) => {
      if (!getMap() || !regionPopup || activeRegionPopupKey !== popupKey) return;
      regionPopup.setHTML(buildRegionPopupHtml(code, sourceMessage));
    });
  };

  /** Привязывает layer-specific pointer-события после создания слоёв. */
  const wire = (): void => {
    const map = getMap();
    if (!map) return;

    const onPick = (event: MapLayerMouseEvent): void => {
      const code = event.features?.[0]?.properties?.regionCode;
      if (typeof code === "string") {
        selectRegion(code === getHighlightedRegionCode() ? null : code);
      }
    };
    const onTrackHover = (event: MapLayerMouseEvent): void => {
      if (focusedTrackId) return;
      const trackId = trackIdFromEvent(event);
      if (!trackId || trackId === hoveredTrackId) return;
      hoveredTrackId = trackId;
      map.getCanvas().style.cursor = "pointer";
      setLocusDebugFocus("hover", trackId);
      applyLocusFocus();
    };
    const onTrackHoverEnd = (): void => {
      if (focusedTrackId || !hoveredTrackId) return;
      hoveredTrackId = null;
      map.getCanvas().style.cursor = "";
      setLocusDebugFocus("none", null);
      applyLocusFocus();
    };
    const onTrackPick = (event: MapLayerMouseEvent): void => {
      const trackId = trackIdFromEvent(event);
      if (trackId) selectTrack(trackId === focusedTrackId ? null : trackId);
    };
    const onPlaceHover = (event: MapLayerMouseEvent): void => {
      const placeId = event.features?.[0]?.properties?.placeId;
      if (typeof placeId === "string" && placeId) showPlacePopup(event.lngLat, placeId);
    };
    const onPlaceHoverEnd = (): void => {
      map.getCanvas().style.cursor = "";
      activePlacePopupId = null;
      placePopup?.remove();
      placePopup = null;
    };
    const onRegionHover = (event: MapLayerMouseEvent): void => {
      if (hasChildEntityAtPointer(map, event.point)) {
        regionPopup?.remove();
        regionPopup = null;
        activeRegionPopupKey = null;
        return;
      }
      const code = event.features?.[0]?.properties?.regionCode;
      if (typeof code === "string" && code) showRegionPopup(event.lngLat, code);
    };
    const onRegionHoverEnd = (): void => {
      map.getCanvas().style.cursor = "";
      activeRegionPopupKey = null;
      regionPopup?.remove();
      regionPopup = null;
    };

    map.on("click", REGIONS_FILL, onPick);
    map.on("click", REGIONS_OUTLINE, onPick);
    map.on("click", PLACES_LAYER, onPick);
    map.on("mouseenter", PLACES_LAYER, onPlaceHover);
    map.on("mousemove", PLACES_LAYER, onPlaceHover);
    map.on("mouseleave", PLACES_LAYER, onPlaceHoverEnd);
    map.on("mouseenter", DISTRICTS_FILL, onPlaceHover);
    map.on("mousemove", DISTRICTS_FILL, onPlaceHover);
    map.on("mouseleave", DISTRICTS_FILL, onPlaceHoverEnd);
    map.on("mouseenter", DISTRICTS_OUTLINE, onPlaceHover);
    map.on("mousemove", DISTRICTS_OUTLINE, onPlaceHover);
    map.on("mouseleave", DISTRICTS_OUTLINE, onPlaceHoverEnd);
    map.on("mousemove", REGIONS_FILL, onRegionHover);
    map.on("mouseleave", REGIONS_FILL, onRegionHoverEnd);

    for (const layerId of [
      TRACKS_LINES_LAYER,
      TRACKS_LINES_DASHED_LAYER,
      TRACKS_LINES_HIT_LAYER,
      TRACKS_LINES_DASHED_HIT_LAYER,
      TRACKS_ORIGIN_LAYER,
    ]) {
      map.on("click", layerId, onTrackPick);
      map.on("mouseenter", layerId, onTrackHover);
      map.on("mousemove", layerId, onTrackHover);
      map.on("mouseleave", layerId, onTrackHoverEnd);
    }
  };

  return {
    wire,
    applyLocusFocus,
    getActiveLocusTrackId: (): string | null => focusedTrackId ?? hoveredTrackId,
    onTrackSelection(trackId: string | null): void {
      focusedTrackId = trackId;
      if (trackId) {
        hoveredTrackId = null;
        setLocusDebugFocus("pinned", trackId);
      } else {
        setLocusDebugFocus(hoveredTrackId ? "hover" : "none", hoveredTrackId);
      }
    },
    clearPopups(): void {
      placePopup?.remove();
      placePopup = null;
      regionPopup?.remove();
      regionPopup = null;
    },
  };
}
