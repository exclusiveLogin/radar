import type { GeoProviderSnapshot, IGeoSourceProvider } from "@radar/shared";
import { listArtifactKeysByPrefix, readArtifactsJson, sourceRevision } from "./geo-provider-utils";

type FeatureCollection = {
  features?: Array<{
    properties?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: unknown };
  }>;
};

function toName(props: Record<string, unknown>): string | null {
  return (
    (typeof props.name === "string" && props.name) ||
    (typeof props.NAME === "string" && props.NAME) ||
    (typeof props.title === "string" && props.title) ||
    null
  );
}

export class RussiaGeoJsonOsmProvider implements IGeoSourceProvider {
  async loadSnapshot(): Promise<GeoProviderSnapshot> {
    const sourceId = "Russia_geojson_OSM";
    const files = listArtifactKeysByPrefix(sourceId, "boundaries/Russia_geojson_OSM");
    const places: GeoProviderSnapshot["places"] = [];
    const aliases: GeoProviderSnapshot["aliases"] = [];

    for (const file of files.filter((f) => f.endsWith(".geojson")).slice(0, 20)) {
      const fc = readArtifactsJson<FeatureCollection>(file);
      if (!fc?.features) continue;
      for (const feature of fc.features) {
        if (!feature.properties) continue;
        const name = toName(feature.properties);
        if (!name) continue;
        places.push({
          regionCode: String(feature.properties.region_code ?? "unknown"),
          kind: "locality",
          name,
          nameWithType: name,
          geometryArtifactKey: file,
        });
        aliases.push({
          targetKind: "place",
          targetExternalKey: `${file}:${name}`,
          alias: name,
          source: "auto",
        });
      }
    }

    return {
      sourceId,
      sourceRevision: sourceRevision(sourceId),
      regions: [],
      places,
      aliases,
    };
  }
}
