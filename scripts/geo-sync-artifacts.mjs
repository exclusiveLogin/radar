#!/usr/bin/env node
// geo:sync
// 1) Проверяет наличие vendor-клонов.
// 2) Копирует разрешенные файлы в data/geo/artifacts.
// 3) Формирует manifest.json (source revision + sha256 + size).
// Скрипт не парсит гео-структуры и не пишет данные в БД.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { loadGeoConfig, repoRoot, runOutput } from './utils.mjs';

const vendorRoot = join(repoRoot, 'data', 'geo', 'vendor');
const artifactsRoot = join(repoRoot, 'data', 'geo', 'artifacts');
const config = loadGeoConfig();

const missing = [];
for (const s of config.sources) {
  const v = join(vendorRoot, s.vendorDir);
  if (!existsSync(join(v, '.git'))) missing.push(s.vendorDir);
}
if (missing.length > 0) {
  console.error(
    `Нет клонов: ${missing.join(', ')}. Запустите: npm run geo:vendor`,
  );
  process.exit(1);
}

mkdirSync(artifactsRoot, { recursive: true });

for (const s of config.sources) {
  const destPrefix = join(artifactsRoot, s.artifactDir);
  // Пересобираем снапшот source-папки целиком, чтобы не держать stale файлы.
  if (existsSync(destPrefix)) rmSync(destPrefix, { recursive: true, force: true });
}

const generatedAt = new Date().toISOString();
/** @type {{ id: string; revision: string; cloneUrl: string; vendorDir: string }[]} */
const manifestSources = [];
/** @type {Record<string, unknown>[]} */
const manifestFiles = [];

/** @param {string} dir */
function* walkFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.git') continue;
      yield* walkFiles(p);
    } else if (e.isFile()) {
      yield p;
    }
  }
}

/** @param {string} absPath */
function sha256File(absPath) {
  const h = createHash('sha256');
  h.update(readFileSync(absPath));
  return h.digest('hex');
}

for (const s of config.sources) {
  const src = join(vendorRoot, s.vendorDir);
  const rev = runOutput('git', ['rev-parse', 'HEAD'], { cwd: src });
  manifestSources.push({
    id: s.id,
    revision: rev,
    cloneUrl: s.cloneUrl,
    vendorDir: s.vendorDir,
  });

  const exts = new Set(
    s.includeExtensions.map((x) => String(x).toLowerCase()),
  );
  const destBase = join(artifactsRoot, s.artifactDir);
  mkdirSync(destBase, { recursive: true });
  const srcResolved = resolve(src);

  for (const full of walkFiles(src)) {
    const ext =
      full.lastIndexOf('.') >= 0
        ? full.slice(full.lastIndexOf('.')).toLowerCase()
        : '';
    // В artifacts попадает только whitelist расширений из geo-sources.json.
    if (!exts.has(ext)) continue;

    const relFromVendor = relative(srcResolved, full).replace(/\\/g, '/');
    const destFile = join(destBase, relFromVendor);
    mkdirSync(dirname(destFile), { recursive: true });
    copyFileSync(full, destFile);

    const hash = sha256File(destFile);
    const len = statSync(destFile).size;
    const relFromArtifacts = relative(artifactsRoot, destFile).replace(
      /\\/g,
      '/',
    );

    manifestFiles.push({
      artifactKey: relFromArtifacts,
      relPath: relFromArtifacts,
      sourceId: s.id,
      sourceRevision: rev,
      cloneUrl: s.cloneUrl,
      sha256: hash,
      byteSize: len,
    });
  }
}

const manifest = {
  version: config.version,
  generatedAt,
  sources: manifestSources,
  files: manifestFiles,
};

const manifestPath = join(artifactsRoot, 'manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Снапшот: ${artifactsRoot}`);
console.log(`Файлов: ${manifestFiles.length}. Манифест: ${manifestPath}`);
console.log(
  'Дальше: git add data/geo/artifacts && (опционально) npm run geo:seed',
);
