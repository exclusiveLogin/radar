#!/usr/bin/env node
// Скачивание vendor-клонов в data/geo/vendor (не в git).
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadGeoConfig, repoRoot, run } from './utils.mjs';

const vendor = join(repoRoot, 'data', 'geo', 'vendor');
const config = loadGeoConfig();
mkdirSync(vendor, { recursive: true });

console.log(`Каталог vendor: ${vendor}`);

for (const s of config.sources) {
  const dest = join(vendor, s.vendorDir);
  if (existsSync(join(dest, '.git'))) {
    console.log(
      `[skip] ${s.vendorDir} уже есть — npm run geo:vendor:pull`,
    );
    continue;
  }
  console.log(`[clone] ${s.id} ← ${s.cloneUrl}`);
  run('git', ['clone', '--depth', '1', s.cloneUrl, dest]);
}

console.log('Готово. Дальше: npm run geo:sync');
