import * as fs from "node:fs";
import * as path from "node:path";

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
  return path.resolve(process.cwd(), "../../data/geo/artifacts");
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
