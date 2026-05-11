import type { GeoProviderSnapshot, IGeoSourceProvider } from "@radar/shared";
import { listArtifactKeysByPrefix, normalizeName, readArtifactsJson, sourceRevision } from "./geo-provider-utils";

type FeatureCollection = {
  features?: Array<{
    properties?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: unknown };
  }>;
};

type PathKind = "countries" | "federal-districts" | "regions" | "cities" | "unknown";

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

function resolvePathKind(file: string): PathKind {
  if (file.includes("/Countries/")) return "countries";
  if (file.includes("/Federal Districts/")) return "federal-districts";
  if (file.includes("/Regions/")) return "regions";
  if (file.includes("/Cities/")) return "cities";
  return "unknown";
}

function readStringProperty(
  props: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = props[key];
  return typeof value === "string" ? value : undefined;
}

function appendRegionDraft(options: {
  file: string;
  featureProps: Record<string, unknown>;
  regions: GeoProviderSnapshot["regions"];
  aliases: GeoProviderSnapshot["aliases"];
}): void {
  const regionName =
    typeof options.featureProps.region === "string"
      ? options.featureProps.region
      : toName(options.featureProps);
  if (!regionName) {
    return;
  }

  const regionCode = normalizeName(regionName);
  options.regions.push({
    iso: regionCode,
    name: regionName,
    nameWithType: regionName,
    geometryArtifactKey: options.file,
    frontRegion: false,
    borderRegion: false,
    sourceMeta: {
      sourceLayer: "countries",
    },
  });
  options.aliases.push({
    targetKind: "region",
    targetExternalKey: regionCode,
    alias: regionName,
    source: "auto",
  });
}

function appendPlaceDraft(options: {
  file: string;
  featureProps: Record<string, unknown>;
  pathKind: PathKind;
  regionNameFromFile?: string;
  places: GeoProviderSnapshot["places"];
  aliases: GeoProviderSnapshot["aliases"];
}): void {
  const placeName =
    typeof options.featureProps.district === "string"
      ? options.featureProps.district
      : toName(options.featureProps);
  if (!placeName) {
    return;
  }

  const regionHint =
    typeof options.featureProps.region === "string"
      ? options.featureProps.region
      : options.regionNameFromFile;
  const regionCode = regionHint ? normalizeName(regionHint) : "unknown";

  options.places.push({
    regionCode,
    kind: "locality",
    name: placeName,
    nameWithType: placeName,
    geometryArtifactKey: options.file,
    sourceMeta: {
      sourceLayer: options.pathKind,
      federalDistrict: readStringProperty(options.featureProps, "Federal District"),
    },
  });
  options.aliases.push({
    targetKind: "place",
    targetExternalKey: `${regionCode}:locality:${normalizeName(placeName)}`,
    alias: placeName,
    source: "auto",
  });
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
      const pathKind = resolvePathKind(file);
      const regionNameFromFile = pathKind === "regions" ? firstSegmentName(file) : undefined;

      for (const feature of fc.features) {
        if (!feature.properties) continue;
        if (pathKind === "countries") {
          appendRegionDraft({
            file,
            featureProps: feature.properties,
            regions,
            aliases,
          });
          continue;
        }
        appendPlaceDraft({
          file,
          featureProps: feature.properties,
          pathKind,
          regionNameFromFile,
          places,
          aliases,
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
