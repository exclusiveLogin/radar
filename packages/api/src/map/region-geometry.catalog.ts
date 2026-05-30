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
function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
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
    this.indexSubjectOutlineLabels();
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

  private fillNormIndex(
    regions: Array<{
      iso: string | null;
      name: string;
      nameWithType?: string | null;
    }>,
  ): void {
    for (const region of regions) {
      if (!region.iso) continue;
      this.isoByNorm.set(norm(region.name), region.iso);
      if (region.nameWithType) this.isoByNorm.set(norm(region.nameWithType), region.iso);
      const short = region.name.split(/\s+/)[0];
      if (short) this.isoByNorm.set(norm(short), region.iso);
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
      const nameWithType = cols[2];
      const iso = cols[10];
      if (!name || !iso?.startsWith("RU-")) continue;
      this.isoByNorm.set(norm(name), iso);
      if (nameWithType) this.isoByNorm.set(norm(nameWithType), iso);
    }
  }

  /** Подписи из Russia_regions.geojson (например «Воронежская обл.»). */
  private indexSubjectOutlineLabels(): void {
    for (const feature of this.loadSubjectOutlines().features) {
      const label = String(feature.properties.region ?? "");
      const iso = this.resolveIso(label);
      if (!iso || !label) continue;
      this.isoByNorm.set(norm(label), iso);
    }
  }

  private resolveIso(label: string): string | undefined {
    const direct = this.isoByNorm.get(norm(label));
    if (direct) return direct;
    return this.matchBySubstring(label, this.isoByNorm);
  }

  private matchBySubstring(
    label: string,
    byNorm: Map<string, string>,
  ): string | undefined {
    const needle = norm(label);
    if (!needle) return undefined;
    for (const [nameNorm, iso] of byNorm) {
      if (nameNorm.includes(needle) || needle.includes(nameNorm.split(" ")[0] ?? "")) {
        return iso;
      }
    }
    return undefined;
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
