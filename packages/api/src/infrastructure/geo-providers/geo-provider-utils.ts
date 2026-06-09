import * as fs from "node:fs";
import * as path from "node:path";
import { repoDataPath } from "../../monorepo-root";

type Manifest = {
  version: number;
  generatedAt: string | null;
  sources: Array<{
    id: string;
    revision: string;
    cloneUrl: string;
    vendorDir: string;
  }>;
  files: Array<{
    artifactKey: string;
    sourceId: string;
    sourceRevision: string;
  }>;
};
function getArtifactsRoot(): string {
  return repoDataPath("geo", "artifacts");
}
export function loadArtifactsManifest(): Manifest {
  const artifactsRoot = getArtifactsRoot();
  const manifestPath = path.join(artifactsRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { version: 1, generatedAt: null, sources: [], files: [] };
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as Manifest;
}
export function readArtifactsJson<T>(artifactKey: string): T | null {
  const fullPath = path.join(getArtifactsRoot(), artifactKey);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as T;
}
export function readArtifactsText(artifactKey: string): string | null {
  const fullPath = path.join(getArtifactsRoot(), artifactKey);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  return fs.readFileSync(fullPath, "utf8");
}
export function listArtifactKeysByPrefix(sourceId: string, prefix: string): string[] {
  const manifest = loadArtifactsManifest();
  return manifest.files
    .filter((f) => f.sourceId === sourceId && f.artifactKey.startsWith(prefix))
    .map((f) => f.artifactKey);
}
export function sourceRevision(sourceId: string): string {
  const manifest = loadArtifactsManifest();
  return (
    manifest.sources.find((s) => s.id === sourceId)?.revision ?? "unknown"
  );
}
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Стабильный ключ place draft: FIAS → ОКТМО → region+kind+name. */
export function resolvePlaceDraftKey(row: {
  fiasId?: string;
  oktmo?: string;
  regionCode: string;
  kind: string;
  name: string;
}): string {
  if (row.fiasId) {
    return row.fiasId;
  }
  if (row.oktmo) {
    return `${row.regionCode}:oktmo:${row.oktmo}`;
  }
  return `${row.regionCode}:${row.kind}:${normalizeName(row.name)}`;
}

type GeoJsonGeometry = { type?: string; coordinates?: unknown };

/** Центроид по bbox GeoJSON-геометрии (достаточно для точки на карте). */
export function centroidFromGeoJsonGeometry(geometry?: GeoJsonGeometry): {
  centroidLat?: number;
  centroidLon?: number;
} {
  if (!geometry?.coordinates) return {};

  const points: Array<[number, number]> = [];
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      points.push([coords[0], coords[1]]);
      return;
    }
    for (const child of coords) walk(child);
  };
  walk(geometry.coordinates);
  if (points.length === 0) return {};

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return {
    centroidLon: (minLon + maxLon) / 2,
    centroidLat: (minLat + maxLat) / 2,
  };
}
