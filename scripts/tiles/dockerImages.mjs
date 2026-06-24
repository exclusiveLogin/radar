/** SSOT Docker-образов для tiles-пайплайна (GHCR osmium-tool часто denied без login). */

const DEFAULTS = {
  osmium: 'iboates/osmium:latest',
  tilemaker: 'ghcr.io/systemed/tilemaker:master',
};

/**
 * @param {{ docker?: { osmium?: string, tilemaker?: string } } | undefined} manifest
 * @param {'osmium' | 'tilemaker'} tool
 */
export function resolveTilesDockerImage(manifest, tool) {
  const fromManifest = manifest?.docker?.[tool]?.trim();
  if (fromManifest) return fromManifest;

  const envKey = tool === 'osmium' ? 'TILES_OSMIUM_IMAGE' : 'TILES_TILEMAKER_IMAGE';
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;

  return DEFAULTS[tool];
}
