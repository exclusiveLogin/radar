#!/usr/bin/env node
/**
 * Проверка артефактов tiles + build.manifest.json.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { join } from 'node:path';
import { createRootCliReporter } from '../cli-reporter.mjs';
import { repoRoot } from '../utils.mjs';
import { loadGeoBasemapManifest } from './loadGeoBasemapManifest.mjs';

const reporter = createRootCliReporter();
const manifest = loadGeoBasemapManifest(repoRoot);

/** Потоковый SHA-256 — merged .pbf и mbtiles > 2 GiB (лимит readFileSync в Node). */
async function sha256(path) {
  const h = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => h.update(chunk));
  await finished(stream);
  return h.digest('hex');
}

async function main() {
  reporter.log('\x1b[36m=== tiles:verify ===\x1b[0m');
  const files = [
    manifest.merge.outputPath,
    manifest.themes.light.mbtiles,
    manifest.themes.dark.mbtiles,
    manifest.tileserver.configPath,
  ];

  const entries = [];
  for (const rel of files) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) {
      throw new Error(`Отсутствует: ${rel}`);
    }
    const st = statSync(abs);
    reporter.log(`  hash ${rel}…`);
    entries.push({
      path: rel,
      sizeBytes: st.size,
      sha256: await sha256(abs),
      updatedAt: st.mtime.toISOString(),
    });
    reporter.log(`  ok ${rel} (${(st.size / 1e6).toFixed(1)} MB)`);
  }

  const buildManifest = {
    generatedAt: new Date().toISOString(),
    manifestId: manifest.id,
    files: entries,
  };

  const outPath = join(repoRoot, 'data', 'tiles', 'build.manifest.json');
  writeFileSync(outPath, JSON.stringify(buildManifest, null, 2));
  reporter.log(`\x1b[32mtiles:verify → data/tiles/build.manifest.json\x1b[0m`);
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
