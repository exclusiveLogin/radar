import type { Map as MapLibreMap } from "maplibre-gl";
import { TRACKS_ORIGIN_LAYER, TRACKS_TRIPS_DECK_LAYER } from "./geoMapLayerIds";
import { threatProfileRgba } from "./tracksMapPaint";
import { TRIPS_ANIM_WINDOW, type TrackTrip, type TracksTripsPayload } from "./tracksTripsData";

/** Wall-clock длительность одного полного прохода по треку (ms). */
const ANIM_LOOP_DURATION_MS = 6_000;
/** Длина «хвоста» в единицах TRIPS_ANIM_WINDOW. */
const TRAIL_LENGTH = TRIPS_ANIM_WINDOW * 0.15;
const TRIPS_WIDTH_MIN_PIXELS = 2.5;

type DeckModules = {
  MapboxOverlay: typeof import("@deck.gl/mapbox").MapboxOverlay;
  TripsLayer: typeof import("@deck.gl/geo-layers").TripsLayer;
};

export type TracksDeckOverlay = {
  update: (payload: TracksTripsPayload) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
};

/** Deck.gl overlay: TripsLayer с непрерывной анимацией направления поверх MapLibre lines. */
export async function createTracksDeckOverlay(map: MapLibreMap): Promise<TracksDeckOverlay> {
  const deck = await import("@deck.gl/mapbox");
  const geoLayers = await import("@deck.gl/geo-layers");

  const modules: DeckModules = {
    MapboxOverlay: deck.MapboxOverlay,
    TripsLayer: geoLayers.TripsLayer,
  };

  let payload: TracksTripsPayload = { trips: [] };
  let visible = false;
  let animStartMs = performance.now();
  let rafId = 0;

  const overlay = new modules.MapboxOverlay({ interleaved: true, layers: [] });
  map.addControl(overlay as never);

  const buildLayer = (currentTime: number) =>
    new modules.TripsLayer<TrackTrip>({
      id: TRACKS_TRIPS_DECK_LAYER,
      data: payload.trips,
      getPath: (d) => d.path,
      getTimestamps: (d) => d.timestamps,
      getColor: (d) => threatProfileRgba(d.threatProfile),
      currentTime,
      trailLength: TRAIL_LENGTH,
      fadeTrail: true,
      capRounded: true,
      jointRounded: true,
      widthMinPixels: TRIPS_WIDTH_MIN_PIXELS,
      // beforeId — z-order в interleaved mode (типы PathLayer не включают mapbox props).
      beforeId: TRACKS_ORIGIN_LAYER,
    } as ConstructorParameters<typeof modules.TripsLayer<TrackTrip>>[0] & { beforeId: string });

  const pushFrame = (): void => {
    if (!visible || payload.trips.length === 0) {
      overlay.setProps({ layers: [] });
      return;
    }
    const currentTime = computeLoopTime(animStartMs);
    overlay.setProps({ layers: [buildLayer(currentTime)] });
  };

  const tick = (): void => {
    pushFrame();
    if (!visible || payload.trips.length === 0) {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const startAnimation = (): void => {
    if (rafId) return;
    rafId = requestAnimationFrame(tick);
  };

  const stopAnimation = (): void => {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  };

  return {
    update(nextPayload) {
      payload = nextPayload;
      if (!visible) return;
      if (payload.trips.length === 0) {
        stopAnimation();
        overlay.setProps({ layers: [] });
        return;
      }
      startAnimation();
    },

    setVisible(nextVisible) {
      visible = nextVisible;
      if (visible && payload.trips.length > 0) {
        animStartMs = performance.now();
        startAnimation();
      } else {
        stopAnimation();
        overlay.setProps({ layers: [] });
      }
    },

    dispose() {
      stopAnimation();
      map.removeControl(overlay as never);
    },
  };
}

/** currentTime 0…TRIPS_ANIM_WINDOW, бесконечный loop. */
function computeLoopTime(animStartMs: number): number {
  const elapsed = (performance.now() - animStartMs) % ANIM_LOOP_DURATION_MS;
  return (elapsed / ANIM_LOOP_DURATION_MS) * TRIPS_ANIM_WINDOW;
}
