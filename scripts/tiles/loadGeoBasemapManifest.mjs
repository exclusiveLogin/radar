import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { geoBasemapManifestSchema } from '@radar/shared';

const DEFAULT_MANIFEST = 'data/geo/tiles.manifest.json';

/**
 * Загружает SSOT basemap manifest (сейчас файл; позже — ODP geoBasemapPack).
 * @param {string} repoRoot
 * @param {string} [relPath]
 */
export function loadGeoBasemapManifest(repoRoot, relPath = DEFAULT_MANIFEST) {
  const abs = join(repoRoot, relPath);
  const raw = JSON.parse(readFileSync(abs, 'utf8'));
  return geoBasemapManifestSchema.parse(raw);
}
