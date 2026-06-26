import * as fs from "node:fs";
import type { StateLevel } from "@radar/shared";
import { repoDataPath } from "../monorepo-root";
import { centroidFromGeoJsonGeometry } from "../infrastructure/geo-providers/geo-provider-utils";

type GeoJsonFeature = {
  type: "Feature";
  id?: string;
  properties: Record<string, string | number>;
  geometry: { type: string; coordinates: unknown };
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

/** Один контур на субъект РФ (без сетки районов). */
const SUBJECT_OUTLINES_PATH = repoDataPath(
  "geo",
  "artifacts",
  "boundaries",
  "Russia_geojson_OSM",
  "GeoJson's",
  "Countries",
  "Russia_regions.geojson",
);

/** ДНР/ЛНР/Запорожье/Херсон — вне Russia_regions.geojson (OSM-85). */
const SUPPLEMENTAL_OUTLINES_PATH = repoDataPath(
  "geo",
  "artifacts",
  "boundaries",
  "supplemental",
  "front-regions.geojson",
);

/** Подписи OSM Russia_regions → ISO (Крым/Севастополь в hflabs как UA-*). */
const FIXED_LABEL_ISO: Record<string, string> = {
  "республика крым": "RU-CR",
  "город федерального значения севастополь": "RU-SEV",
};

/** Нормализация для сопоставления подписей GeoJSON и ISO. */
export function normRegionLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Алиасы подписей OSM (Russia_regions.geojson) к ISO из region.csv.
 * Только явные строки — без substring/fuzzy (иначе все «Республика …» → один регион).
 */
export function registerRegionIsoAliases(
  index: Map<string, string>,
  input: {
    name: string;
    nameWithType?: string;
    shortName?: string;
    subjectType?: string;
    iso: string;
  },
): void {
  const put = (label: string) => {
    const key = normRegionLabel(label);
    if (key) index.set(key, input.iso);
  };

  put(input.name);
  if (input.shortName) put(input.shortName);

  if (input.nameWithType) {
    put(input.nameWithType);
    const oblast = input.nameWithType.match(/^(.+?)\s+область(.*)$/i);
    if (oblast?.[1]) {
      const tail = oblast[2] ?? "";
      put(`${oblast[1]} обл.${tail}`.replace(/\.\s+-/, ". -"));
      put(`${oblast[1]} обл${tail}`);
    }
    if (input.nameWithType.includes("город федерального значения")) {
      const city = input.nameWithType
        .replace(/город федерального значения\s+/i, "")
        .trim();
      if (city) put(`г. ${city}`);
    }
    if (input.nameWithType.endsWith(" обл")) {
      put(`${input.nameWithType}.`);
    }
  }

  if (input.nameWithType?.startsWith("Республика ")) {
    const tail = input.name.trim();
    if (tail) put(`Республика ${tail} (${tail})`);
  }

  if (input.subjectType === "Респ") {
    const slash = input.name.indexOf("/");
    const base =
      slash >= 0 ? input.name.slice(0, slash).trim() : input.name.trim();
    const tail =
      slash >= 0 ? input.name.slice(slash + 1).replace(/\//g, "").trim() : "";

    put(`Республика ${base}`);
    if (tail) put(`Республика ${base} (${tail})`);
    put(`${input.name} Республика`);
  }

  // OSM Russia_regions.geojson: «… АО», «… Республика» вместо полных nameWithType
  const nameWithType = input.nameWithType ?? "";
  if (/автономная\s+область/i.test(nameWithType)) {
    put(`${input.name} АО`);
  }
  if (/автономный\s+округ/i.test(nameWithType)) {
    put(nameWithType.replace(/автономный\s+округ/gi, "АО"));
    put(`${input.name} АО`);
  }
  const republicShort = nameWithType.match(/^(.+?)\s+Респ\.?$/i);
  if (republicShort?.[1]) {
    put(`${republicShort[1].trim()} Республика`);
  }
}

/**
 * Контуры субъектов РФ для гео-карты: один полигон на регион из Russia_regions.geojson.
 */
export class RegionGeometryCatalog {
  private static instance: RegionGeometryCatalog | null = null;

  /** norm(название) -> ISO */
  private readonly isoByNorm = new Map<string, string>();

  private subjectOutlines: GeoJsonFeatureCollection | null = null;
  private supplementalOutlines: GeoJsonFeatureCollection | null = null;

  static getInstance(): RegionGeometryCatalog {
    if (!RegionGeometryCatalog.instance) {
      RegionGeometryCatalog.instance = new RegionGeometryCatalog();
    }
    return RegionGeometryCatalog.instance;
  }

  static resetForTests(): void {
    RegionGeometryCatalog.instance = null;
  }

  /**
   * Индекс ISO по именам регионов (БД + region.csv).
   */
  bindRegions(
    regions: Array<{
      iso: string | null;
      name: string;
      nameWithType?: string | null;
      shortName?: string | null;
    }>,
  ): void {
    this.isoByNorm.clear();
    this.fillNormIndex(regions);
    this.fillNormIndexFromReferenceCsv();
  }

  /**
   * GeoJSON контуров для MapLibre: по одному feature на субъект, с regionCode/stateLevel.
   */
  buildLayer(
    stateByIso: Map<string, StateLevel>,
    options?: { includeGrey?: boolean },
  ): GeoJsonFeatureCollection {
    const includeGrey = options?.includeGrey ?? false;
    const features: GeoJsonFeature[] = [];

    for (const template of [
      ...this.loadSubjectOutlines().features,
      ...this.loadSupplementalOutlines().features,
    ]) {
      const label = String(template.properties.region ?? "");
      const iso =
        String(template.properties.regionCode ?? "") || this.resolveIso(label);
      if (!iso) continue;

      const stateLevel = stateByIso.get(iso) ?? "grey";
      if (!includeGrey && stateLevel === "grey") continue;

      features.push({
        type: "Feature",
        id: iso,
        properties: {
          regionCode: iso,
          stateLevel,
          kind: "region",
          label,
        },
        geometry: template.geometry,
      });
    }

    return { type: "FeatureCollection", features };
  }

  /**
   * GeoJSON контуров субъектов по ISO-кодам (без fold/stateLevel).
   * Без regionCodes → 400 (не отдаём 44MB целиком).
   */
  buildLayerByCodes(regionCodes: string[]): GeoJsonFeatureCollection {
    const codeSet = new Set(regionCodes.map((code) => code.trim()).filter(Boolean));
    const features: GeoJsonFeature[] = [];

    for (const template of [
      ...this.loadSubjectOutlines().features,
      ...this.loadSupplementalOutlines().features,
    ]) {
      const label = String(template.properties.region ?? "");
      const iso =
        String(template.properties.regionCode ?? "") || this.resolveIso(label);
      if (!iso || !codeSet.has(iso)) continue;

      features.push({
        type: "Feature",
        id: iso,
        properties: {
          regionCode: iso,
          kind: "region",
          label,
        },
        geometry: template.geometry,
      });
    }

    return { type: "FeatureCollection", features };
  }

  /**
   * Центроид (bbox-центр) каждого субъекта по ISO — из геометрии контуров (SSOT).
   * Покрывает все субъекты Russia_regions.geojson + supplemental фронт-регионы.
   * Требует предварительного bindRegions() для резолва подписей субъектных контуров.
   */
  centroidByIso(): Map<string, { centroidLat: number; centroidLon: number }> {
    const out = new Map<string, { centroidLat: number; centroidLon: number }>();

    for (const feature of [
      ...this.loadSubjectOutlines().features,
      ...this.loadSupplementalOutlines().features,
    ]) {
      const label = String(feature.properties.region ?? "");
      const iso =
        String(feature.properties.regionCode ?? "") || this.resolveIso(label);
      if (!iso || out.has(iso)) continue;

      const { centroidLat, centroidLon } = centroidFromGeoJsonGeometry(
        feature.geometry,
      );
      if (centroidLat === undefined || centroidLon === undefined) continue;

      out.set(iso, { centroidLat, centroidLon });
    }

    return out;
  }

  /** Сводка (CLI/тесты). */
  debugStats(): { subjects: number; isoIndex: number; outlineFileExists: boolean } {
    return {
      subjects: this.loadSubjectOutlines().features.length,
      isoIndex: this.isoByNorm.size,
      outlineFileExists: fs.existsSync(SUBJECT_OUTLINES_PATH),
    };
  }

  /** Только для тестов: разрешение подписи OSM → ISO. */
  resolveIsoForTest(label: string): string | undefined {
    return this.resolveIso(label);
  }

  private fillNormIndex(
    regions: Array<{
      iso: string | null;
      name: string;
      nameWithType?: string | null;
      shortName?: string | null;
    }>,
  ): void {
    for (const region of regions) {
      if (!region.iso) continue;
      registerRegionIsoAliases(this.isoByNorm, {
        name: region.name,
        nameWithType: region.nameWithType ?? undefined,
        shortName: region.shortName ?? undefined,
        iso: region.iso,
      });
    }
  }

  private fillNormIndexFromReferenceCsv(): void {
    // Предпочитаем catalog/regions.json (SSOT после рефактора)
    const catalogPath = repoDataPath("geo", "catalog", "regions.json");
    if (fs.existsSync(catalogPath)) {
      try {
        const entries = JSON.parse(
          fs.readFileSync(catalogPath, "utf8").replace(/^\uFEFF/, ""),
        ) as Array<{
          iso?: string;
          name?: string;
          nameWithType?: string;
          shortName?: string;
        }>;
        for (const entry of entries) {
          if (!entry.iso || !entry.name) continue;
          registerRegionIsoAliases(this.isoByNorm, {
            name: entry.name,
            nameWithType: entry.nameWithType,
            shortName: entry.shortName,
            iso: entry.iso,
          });
        }
        return;
      } catch {
        // Fallback to CSV below
      }
    }

    // Fallback: исторический hflabs CSV (может отсутствовать после vendor-чистки)
    const csvPath = repoDataPath(
      "geo", "artifacts", "reference", "hflabs-region", "region.csv",
    );
    if (!fs.existsSync(csvPath)) return;

    const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/);
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line?.trim()) continue;
      const cols = line.split(",");
      const name = cols[0];
      const subjectType = cols[1];
      const nameWithType = cols[2];
      const iso = cols[10];
      if (!name || !iso?.startsWith("RU-")) continue;
      registerRegionIsoAliases(this.isoByNorm, { name, nameWithType, subjectType, iso });
    }
  }

  /** Только точное совпадение norm(label) — без substring. */
  private resolveIso(label: string): string | undefined {
    const key = normRegionLabel(label);
    return FIXED_LABEL_ISO[key] ?? this.isoByNorm.get(key);
  }

  private loadSubjectOutlines(): GeoJsonFeatureCollection {
    if (this.subjectOutlines) return this.subjectOutlines;
    if (!fs.existsSync(SUBJECT_OUTLINES_PATH)) {
      this.subjectOutlines = { type: "FeatureCollection", features: [] };
      return this.subjectOutlines;
    }

    const raw = JSON.parse(fs.readFileSync(SUBJECT_OUTLINES_PATH, "utf8")) as {
      features?: Array<{
        type?: string;
        geometry?: { type: string; coordinates: unknown };
        properties?: { region?: string };
      }>;
    };

    const features: GeoJsonFeature[] = [];
    for (const feature of raw.features ?? []) {
      if (!feature.geometry?.type || !feature.geometry.coordinates) continue;
      const geomType = feature.geometry.type;
      if (geomType !== "Polygon" && geomType !== "MultiPolygon") continue;
      const label = feature.properties?.region ?? "";
      features.push({
        type: "Feature",
        properties: { region: label },
        geometry: { type: geomType, coordinates: feature.geometry.coordinates },
      });
    }

    this.subjectOutlines = { type: "FeatureCollection", features };
    return this.subjectOutlines;
  }

  private loadSupplementalOutlines(): GeoJsonFeatureCollection {
    if (this.supplementalOutlines) return this.supplementalOutlines;
    if (!fs.existsSync(SUPPLEMENTAL_OUTLINES_PATH)) {
      this.supplementalOutlines = { type: "FeatureCollection", features: [] };
      return this.supplementalOutlines;
    }

    const raw = JSON.parse(
      fs.readFileSync(SUPPLEMENTAL_OUTLINES_PATH, "utf8"),
    ) as {
      features?: Array<{
        geometry?: { type: string; coordinates: unknown };
        properties?: { region?: string; regionCode?: string };
      }>;
    };

    const features: GeoJsonFeature[] = [];
    for (const feature of raw.features ?? []) {
      const geomType = feature.geometry?.type;
      if (
        !feature.geometry?.coordinates
        || (geomType !== "Polygon" && geomType !== "MultiPolygon")
      ) {
        continue;
      }
      features.push({
        type: "Feature",
        properties: {
          region: String(feature.properties?.region ?? ""),
          regionCode: String(feature.properties?.regionCode ?? ""),
        },
        geometry: {
          type: geomType,
          coordinates: feature.geometry.coordinates,
        },
      });
    }

    this.supplementalOutlines = { type: "FeatureCollection", features };
    return this.supplementalOutlines;
  }
}

export type RegionsGeoJsonLayer = ReturnType<RegionGeometryCatalog["buildLayer"]>;
