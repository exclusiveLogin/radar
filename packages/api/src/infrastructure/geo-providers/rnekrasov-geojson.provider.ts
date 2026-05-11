import type { GeoProviderSnapshot, IGeoSourceProvider } from "@radar/shared";
import { listArtifactKeysByPrefix, normalizeName, readArtifactsJson, sourceRevision } from "./geo-provider-utils";

type FeatureCollection = {
  features?: Array<{
    properties?: Record<string, unknown>;
  }>;
};

type FeatureProps = Record<string, unknown>;

/** Extracts best-available place/region name from feature properties. */
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

/** Appends region draft from subjects layer feature. */
function appendSubjectRegion(options: {
  file: string;
  props: FeatureProps;
  fallbackName: string;
  regions: GeoProviderSnapshot["regions"];
  aliases: GeoProviderSnapshot["aliases"];
}): void {
  const regionNameRu =
    typeof options.props.NL_NAME_1 === "string"
      ? options.props.NL_NAME_1
      : options.fallbackName;
  const regionCode = normalizeName(regionNameRu);
  options.regions.push({
    iso: regionCode,
    name: regionNameRu,
    nameWithType:
      typeof options.props.TYPE_1 === "string"
        ? `${options.props.TYPE_1} ${regionNameRu}`
        : regionNameRu,
    geometryArtifactKey: options.file,
    frontRegion: false,
    borderRegion: false,
    sourceMeta: {
      sourceLayer: "subjects",
      nameEn:
        typeof options.props.NAME_1 === "string" ? options.props.NAME_1 : undefined,
      engType:
        typeof options.props.ENGTYPE_1 === "string"
          ? options.props.ENGTYPE_1
          : undefined,
    },
  });
  options.aliases.push({
    targetKind: "region",
    targetExternalKey: regionCode,
    alias: regionNameRu,
    source: "auto",
  });
  if (typeof options.props.NAME_1 === "string") {
    options.aliases.push({
      targetKind: "region",
      targetExternalKey: regionCode,
      alias: options.props.NAME_1,
      source: "auto",
    });
  }
}

/** Appends place draft and aliases from admin-level feature. */
function appendAdminPlace(options: {
  file: string;
  props: FeatureProps;
  placeName: string;
  places: GeoProviderSnapshot["places"];
  aliases: GeoProviderSnapshot["aliases"];
}): void {
  const regionHint =
    typeof options.props["addr:region"] === "string"
      ? options.props["addr:region"]
      : undefined;
  const regionCode = regionHint ? normalizeName(regionHint) : "unknown";
  const aliasesFromProps = [
    options.props["name:ru"],
    options.props["name:en"],
    options.props["alt_name"],
    options.props["old_name"],
    options.props["short_name"],
    options.props["full_name"],
  ]
    .flatMap((value) =>
      typeof value === "string" ? value.split(";").map((x) => x.trim()) : [],
    )
    .filter(Boolean);

  options.places.push({
    regionCode,
    kind: "locality",
    name: options.placeName,
    nameWithType: options.placeName,
    geometryArtifactKey: options.file,
    aliases: aliasesFromProps,
    sourceMeta: {
      sourceLayer: "admin_target",
      adminLevel:
        typeof options.props.admin_level === "string"
          ? options.props.admin_level
          : undefined,
      place: typeof options.props.place === "string" ? options.props.place : undefined,
      district:
        typeof options.props["addr:district"] === "string"
          ? options.props["addr:district"]
          : undefined,
      population:
        typeof options.props.population === "string"
          ? options.props.population
          : undefined,
    },
  });
  options.aliases.push({
    targetKind: "place",
    targetExternalKey: `${regionCode}:locality:${normalizeName(options.placeName)}`,
    alias: options.placeName,
    source: "auto",
  });
}

export class RnekrasovGeoJsonProvider implements IGeoSourceProvider {
  /** Loads mixed region/place snapshot from rnekrasov geojson artifacts. */
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
          appendSubjectRegion({
            file,
            props: feature.properties,
            fallbackName: name,
            regions,
            aliases,
          });
          continue;
        }

        if (!isTargetAdmin) {
          continue;
        }

        appendAdminPlace({
          file,
          props: feature.properties,
          placeName: name,
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
