#!/usr/bin/env node
// Скачивание vendor-клонов в data/geo/vendor (не в git).
// Этот скрипт отвечает только за "сырье" источников (git clone),
// без парсинга форматов и без записи в БД.
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadGeoConfig, repoRoot, run } from './utils.mjs';

const vendor = join(repoRoot, 'data', 'geo', 'vendor');
const config = loadGeoConfig();
mkdirSync(vendor, { recursive: true });

console.log(`Каталог vendor: ${vendor}`);

for (const s of config.sources) {
  const dest = join(vendor, s.vendorDir);
  // Если локальный clone уже есть, не трогаем: обновление делает geo:vendor:pull.
  if (existsSync(join(dest, '.git'))) {
    console.log(
      `[skip] ${s.vendorDir} уже есть — npm run geo:vendor:pull`,
    );
    continue;
  }
  // Берем shallow clone: быстро и достаточно для построения artifact snapshot.
  console.log(`[clone] ${s.id} ← ${s.cloneUrl}`);
  run('git', ['clone', '--depth', '1', s.cloneUrl, dest]);
}

console.log('Готово. Дальше: npm run geo:sync');
