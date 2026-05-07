import type { GeoProviderSnapshot, IGeoSourceProvider } from "@radar/shared";
import { listArtifactKeysByPrefix, normalizeName, readArtifactsJson, sourceRevision } from "./geo-provider-utils";

type FeatureCollection = {
  features?: Array<{
    properties?: Record<string, unknown>;
  }>;
};

function nameFromProperties(props: Record<string, unknown>): string | null {
  const candidates = [
    props.name,
    props["name:ru"],
    props["official_name"],
    props.NAME,
    props.title,
    props.full_name,
    props.NL_NAME_1,
  ];
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
    const regions: GeoProviderSnapshot["regions"] = [];
    const places: GeoProviderSnapshot["places"] = [];
    const aliases: GeoProviderSnapshot["aliases"] = [];

    for (const file of files.filter((f) => f.endsWith(".geojson") || f.endsWith(".json"))) {
      const fc = readArtifactsJson<FeatureCollection>(file);
      if (!fc?.features) continue;
      const isSubjects = file.endsWith("russia_subjects_github.json");
      const isTargetAdmin = file.includes("admin_level_10") || file.includes("admin_level_9");
      for (const feature of fc.features) {
        if (!feature.properties) continue;
        const name = nameFromProperties(feature.properties);
        if (!name) continue;

        if (isSubjects) {
          const regionNameRu =
            typeof feature.properties.NL_NAME_1 === "string"
              ? feature.properties.NL_NAME_1
              : name;
          const regionCode = normalizeName(regionNameRu);
          regions.push({
            iso: regionCode,
            name: regionNameRu,
            nameWithType:
              typeof feature.properties.TYPE_1 === "string"
                ? `${feature.properties.TYPE_1} ${regionNameRu}`
                : regionNameRu,
            geometryArtifactKey: file,
            frontRegion: false,
            borderRegion: false,
            sourceMeta: {
              sourceLayer: "subjects",
              nameEn:
                typeof feature.properties.NAME_1 === "string"
                  ? feature.properties.NAME_1
                  : undefined,
              engType:
                typeof feature.properties.ENGTYPE_1 === "string"
                  ? feature.properties.ENGTYPE_1
                  : undefined,
            },
          });
          aliases.push({
            targetKind: "region",
            targetExternalKey: regionCode,
            alias: regionNameRu,
            source: "auto",
          });
          if (typeof feature.properties.NAME_1 === "string") {
            aliases.push({
              targetKind: "region",
              targetExternalKey: regionCode,
              alias: feature.properties.NAME_1,
              source: "auto",
            });
          }
          continue;
        }

        if (!isTargetAdmin) {
          continue;
        }

        const regionHint =
          typeof feature.properties["addr:region"] === "string"
            ? feature.properties["addr:region"]
            : undefined;
        const regionCode = regionHint ? normalizeName(regionHint) : "unknown";
        const aliasesFromProps = [
          feature.properties["name:ru"],
          feature.properties["name:en"],
          feature.properties["alt_name"],
          feature.properties["old_name"],
          feature.properties["short_name"],
          feature.properties["full_name"],
        ]
          .flatMap((value) =>
            typeof value === "string"
              ? value.split(";").map((x) => x.trim())
              : [],
          )
          .filter(Boolean);

        places.push({
          regionCode,
          kind: "locality",
          name,
          nameWithType: name,
          geometryArtifactKey: file,
          aliases: aliasesFromProps,
          sourceMeta: {
            sourceLayer: isTargetAdmin ? "admin_target" : "admin_other",
            adminLevel:
              typeof feature.properties.admin_level === "string"
                ? feature.properties.admin_level
                : undefined,
            place:
              typeof feature.properties.place === "string"
                ? feature.properties.place
                : undefined,
            district:
              typeof feature.properties["addr:district"] === "string"
                ? feature.properties["addr:district"]
                : undefined,
            population:
              typeof feature.properties.population === "string"
                ? feature.properties.population
                : undefined,
          },
        });
        aliases.push({
          targetKind: "place",
          targetExternalKey: `${regionCode}:locality:${normalizeName(name)}`,
          alias: name,
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
