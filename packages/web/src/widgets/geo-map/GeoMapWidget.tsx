/**
 * GeoMapWidget — canvas карты (MapLibre). HUD-оверлеи — в AppShell (GeoMapOverlays).
 */
import { useRef } from "react";
import { Panel } from "../../shared/ds";
import type { WidgetProps } from "../widgetProps";
import { useGeoMapLifecycle } from "./useGeoMapLifecycle";

/** Интерактивная карта: только DOM-контейнер и lifecycle-хук. */
export function GeoMapWidget(_props: WidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useGeoMapLifecycle(containerRef);

  return (
    <Panel variant="bare" className="geo-map-panel">
      <div ref={containerRef} className="geo-map-panel__canvas" />
    </Panel>
  );
}
