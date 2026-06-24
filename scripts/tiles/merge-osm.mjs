#!/usr/bin/env node
/**
 * osmium merge по manifest → rf-ua.osm.pbf (Docker).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRootCliReporter, parseCliFlags } from '../cli-reporter.mjs';
import { repoRoot } from '../utils.mjs';
import { loadGeoBasemapManifest } from './loadGeoBasemapManifest.mjs';
import { resolveTilesDockerImage } from './dockerImages.mjs';

const { verbose } = parseCliFlags();
const reporter = createRootCliReporter({ verbose });
const manifest = loadGeoBasemapManifest(repoRoot);
const osmiumImage = resolveTilesDockerImage(manifest, 'osmium');

const sourcesDir = join(repoRoot, 'data', 'tiles', 'sources');
const outputAbs = join(repoRoot, manifest.merge.outputPath);
mkdirSync(dirname(outputAbs), { recursive: true });

const inputPaths = manifest.merge.inputs.map((id) => {
  const source = manifest.sources.find((s) => s.id === id);
  if (!source) throw new Error(`manifest.merge.inputs: неизвестный source ${id}`);
  const path = join(sourcesDir, source.filename);
  if (!existsSync(path)) {
    throw new Error(`Нет файла ${path}. Запустите: npm run tiles:download`);
  }
  return path;
});

function main() {
  reporter.log(`\x1b[36m=== tiles:merge (osmium) ===\x1b[0m`);
  reporter.logVerbose(`image: ${osmiumImage}`);
  const stage = reporter.startStage('osmium merge', 1);

  const relInputs = manifest.merge.inputs.map((id) => {
    const source = manifest.sources.find((s) => s.id === id);
    return `/data/sources/${source.filename}`;
  });
  const relOutput = `/data/merged/${outputAbs.split(/[/\\]/).pop()}`;

  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${join(repoRoot, 'data', 'tiles')}:/data`,
      osmiumImage,
      'merge',
      ...relInputs,
      '-o',
      relOutput,
      '-O',
    ],
    { stdio: verbose ? 'inherit' : 'pipe', cwd: repoRoot },
  );

  if (result.status !== 0) {
    console.error(result.stderr?.toString() ?? 'osmium merge failed');
    process.exit(result.status ?? 1);
  }

  stage.done();
  reporter.log(`\x1b[32mmerge → ${manifest.merge.outputPath}\x1b[0m`);
}

main();
