import type { GeoProviderSnapshot, IGeoSourceProvider } from "@radar/shared";
import { listArtifactKeysByPrefix, normalizeName, readArtifactsJson, sourceRevision } from "./geo-provider-utils";

type FeatureCollection = {
  features?: Array<{
    properties?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: unknown };
  }>;
};

function toName(props: Record<string, unknown>): string | null {
  return (
    (typeof props.name === "string" && props.name.trim()) ||
    (typeof props.NAME === "string" && props.NAME.trim()) ||
    (typeof props.title === "string" && props.title.trim()) ||
    (typeof props.region === "string" && props.region.trim()) ||
    (typeof props.district === "string" && props.district.trim()) ||
    (typeof props["Federal District"] === "string" &&
      String(props["Federal District"]).trim()) ||
    null
  );
}

function firstSegmentName(file: string): string {
  const base = file.split("/").at(-1) ?? file;
  const raw = base.replace(/\.geojson$/i, "");
  const left = raw.includes("_") ? raw.split("_")[0] : raw;
  return left.trim();
}

export class RussiaGeoJsonOsmProvider implements IGeoSourceProvider {
  async loadSnapshot(): Promise<GeoProviderSnapshot> {
    // Источник: предсобранные artifacts из Russia_geojson_OSM.
    // На текущем этапе используем упрощенный name extraction
    // и создаем place/alias drafts.
    const sourceId = "Russia_geojson_OSM";
    const files = listArtifactKeysByPrefix(sourceId, "boundaries/Russia_geojson_OSM");
    const regions: GeoProviderSnapshot["regions"] = [];
    const places: GeoProviderSnapshot["places"] = [];
    const aliases: GeoProviderSnapshot["aliases"] = [];

    for (const file of files.filter((f) => f.endsWith(".geojson"))) {
      const fc = readArtifactsJson<FeatureCollection>(file);
      if (!fc?.features) continue;
      const inCountries = file.includes("/Countries/");
      const inFederalDistricts = file.includes("/Federal Districts/");
      const inRegions = file.includes("/Regions/");
      const inCities = file.includes("/Cities/");
      const regionNameFromFile = inRegions ? firstSegmentName(file) : undefined;

      for (const feature of fc.features) {
        if (!feature.properties) continue;
        if (inCountries) {
          const regionName =
            typeof feature.properties.region === "string"
              ? feature.properties.region
              : toName(feature.properties);
          if (!regionName) continue;
          const regionCode = normalizeName(regionName);
          regions.push({
            iso: regionCode,
            name: regionName,
            nameWithType: regionName,
            geometryArtifactKey: file,
            frontRegion: false,
            borderRegion: false,
            sourceMeta: {
              sourceLayer: "countries",
            },
          });
          aliases.push({
            targetKind: "region",
            targetExternalKey: regionCode,
            alias: regionName,
            source: "auto",
          });
          continue;
        }

        const placeName =
          typeof feature.properties.district === "string"
            ? feature.properties.district
            : toName(feature.properties);
        if (!placeName) continue;
        const regionHint =
          typeof feature.properties.region === "string"
            ? feature.properties.region
            : regionNameFromFile;
        const regionCode = regionHint ? normalizeName(regionHint) : "unknown";
        places.push({
          regionCode,
          kind: "locality",
          name: placeName,
          nameWithType: placeName,
          geometryArtifactKey: file,
          sourceMeta: {
            sourceLayer: inCities
              ? "cities"
              : inRegions
                ? "regions"
                : inFederalDistricts
                  ? "federal-districts"
                  : "unknown",
            federalDistrict:
              typeof feature.properties["Federal District"] === "string"
                ? feature.properties["Federal District"]
                : undefined,
          },
        });
        aliases.push({
          targetKind: "place",
          targetExternalKey: `${regionCode}:locality:${normalizeName(placeName)}`,
          alias: placeName,
          source: "auto",
        });
      }
    }

    return {
      sourceId,
      sourceRevision: sourceRevision(sourceId),
      regions,
      places,
      aliases,
    };
  }
}
