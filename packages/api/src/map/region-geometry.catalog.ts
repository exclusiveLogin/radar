import * as fs from "node:fs";
import type { StateLevel } from "@radar/shared";
import { repoDataPath } from "../monorepo-root";

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
    subjectType?: string;
    iso: string;
  },
): void {
  const put = (label: string) => {
    const key = normRegionLabel(label);
    if (key) index.set(key, input.iso);
  };

  put(input.name);
  if (input.nameWithType) {
    put(input.nameWithType);
    if (input.nameWithType.endsWith(" обл")) {
      put(`${input.nameWithType}.`);
    }
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
}

/**
 * Контуры субъектов РФ для гео-карты: один полигон на регион из Russia_regions.geojson.
 */
export class RegionGeometryCatalog {
  private static instance: RegionGeometryCatalog | null = null;

  /** norm(название) -> ISO */
  private readonly isoByNorm = new Map<string, string>();

  private subjectOutlines: GeoJsonFeatureCollection | null = null;

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

    for (const template of this.loadSubjectOutlines().features) {
      const label = String(template.properties.region ?? "");
      const iso = this.resolveIso(label);
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
    }>,
  ): void {
    for (const region of regions) {
      if (!region.iso) continue;
      registerRegionIsoAliases(this.isoByNorm, {
        name: region.name,
        nameWithType: region.nameWithType ?? undefined,
        iso: region.iso,
      });
    }
  }

  private fillNormIndexFromReferenceCsv(): void {
    const csvPath = repoDataPath(
      "geo",
      "artifacts",
      "reference",
      "hflabs-region",
      "region.csv",
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
      registerRegionIsoAliases(this.isoByNorm, {
        name,
        nameWithType,
        subjectType,
        iso,
      });
    }
  }

  /** Только точное совпадение norm(label) — без substring. */
  private resolveIso(label: string): string | undefined {
    return this.isoByNorm.get(normRegionLabel(label));
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
}

export type RegionsGeoJsonLayer = ReturnType<RegionGeometryCatalog["buildLayer"]>;
