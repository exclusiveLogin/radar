import type { GeoProviderSnapshot, IGeoSourceProvider } from "@radar/shared";
import { listArtifactKeysByPrefix, readArtifactsJson, sourceRevision } from "./geo-provider-utils";

type FeatureCollection = {
  features?: Array<{
    properties?: Record<string, unknown>;
  }>;
};

function nameFromProperties(props: Record<string, unknown>): string | null {
  const candidates = [props.name, props.NAME, props.title, props.full_name];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }
  return null;
}

export class RnekrasovGeoJsonProvider implements IGeoSourceProvider {
  async loadSnapshot(): Promise<GeoProviderSnapshot> {
    // Источник: rnekrasov geojson artifacts.
    // Текущая версия парсит только базовые name-поля и собирает place/alias drafts.
    const sourceId = "rnekrasov-geojson";
    const files = listArtifactKeysByPrefix(sourceId, "boundaries/rnekrasov-geojson");
    const places: GeoProviderSnapshot["places"] = [];
    const aliases: GeoProviderSnapshot["aliases"] = [];

    // TODO: временное ограничение объема для MVP.
    // Для полного покрытия форматов нужно читать весь набор файлов.
    for (const file of files.filter((f) => f.endsWith(".geojson")).slice(0, 20)) {
      const fc = readArtifactsJson<FeatureCollection>(file);
      if (!fc?.features) continue;
      for (const feature of fc.features) {
        if (!feature.properties) continue;
        const name = nameFromProperties(feature.properties);
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
