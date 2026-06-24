#!/usr/bin/env node
/**
 * Сборка vector mbtiles через tilemaker (Docker) + TileServer GL.
 * Двухуровневый режим: overview (вся зона, z≤11) + detail-west (запад, z≤13).
 */
import { basename } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRootCliReporter, parseCliFlags } from '../cli-reporter.mjs';
import { repoRoot } from '../utils.mjs';
import { loadGeoBasemapManifest } from './loadGeoBasemapManifest.mjs';
import { resolveTilesDockerImage } from './dockerImages.mjs';

const { verbose } = parseCliFlags();
const reporter = createRootCliReporter({ verbose });
const manifest = loadGeoBasemapManifest(repoRoot);
const tilemakerImage = resolveTilesDockerImage(manifest, 'tilemaker');

const mergedPath = join(repoRoot, manifest.merge.outputPath);
const outputDir = join(repoRoot, 'data', 'tiles', 'output');
const storeRoot = join(repoRoot, 'data', 'tiles', 'store');

const DEFAULT_TILEMAKER_CONFIG = 'data/geo/tilemaker-rf-ua.json';
const DEFAULT_BBOX = [19, 41, 60, 82];
const TILESERVER_STYLE = {
  light: 'data/geo/tileserver-style-light.json',
  dark: 'data/geo/tileserver-style-dark.json',
};

/**
 * @typedef {{ id: string, configPath: string, bbox: [number, number, number, number], outputRel: string }} TilemakerPlan
 */

/** @returns {TilemakerPlan[]} */
function resolveTilemakerPlans() {
  const tm = manifest.tilemaker;
  if (tm?.overview && tm?.detail) {
    const detailRel = manifest.themes.light.mbtilesDetail;
    if (!detailRel) {
      throw new Error('tilemaker.detail задан, но themes.light.mbtilesDetail отсутствует');
    }
    return [
      {
        id: 'overview',
        configPath: tm.overview.configPath,
        bbox: tm.overview.bbox,
        outputRel: manifest.themes.light.mbtiles,
      },
      {
        id: 'detail-west',
        configPath: tm.detail.configPath,
        bbox: tm.detail.bbox,
        outputRel: detailRel,
      },
    ];
  }

  const configPath = tm?.configPath?.trim() || DEFAULT_TILEMAKER_CONFIG;
  const bbox = tm?.bbox ?? DEFAULT_BBOX;
  return [
    {
      id: 'single',
      configPath,
      bbox,
      outputRel: manifest.themes.light.mbtiles,
    },
  ];
}

/** @param {[number, number, number, number]} bbox */
function formatBboxArg(bbox) {
  return bbox.join(',');
}

/** Доп. аргументы tilemaker: TILES_TILEMAKER_EXTRA_ARGS="--threads 2" */
function tilemakerExtraArgs() {
  const raw = process.env.TILES_TILEMAKER_EXTRA_ARGS?.trim();
  if (!raw) return [];
  return raw.split(/\s+/).filter(Boolean);
}

/** @param {TilemakerPlan} plan */
function runTilemaker(plan) {
  const outputFile = basename(plan.outputRel);
  const configHost = join(repoRoot, plan.configPath);
  if (!existsSync(configHost)) {
    throw new Error(`Нет tilemaker config: ${plan.configPath}`);
  }

  const configMount = `/data/tilemaker-config-${plan.id}.json`;
  const storeDir = join(storeRoot, plan.id);
  const stage = reporter.startStage(`tilemaker:${plan.id}`, 0);

  reporter.log(`[tiles:build] tilemaker:${plan.id} → ${outputFile}`);
  reporter.logVerbose(`image: ${tilemakerImage}`);
  reporter.logVerbose(`bbox: ${formatBboxArg(plan.bbox)}`);
  reporter.logVerbose(`config: ${plan.configPath}`);

  mkdirSync(storeDir, { recursive: true });
  rmSync(storeDir, { recursive: true, force: true });
  mkdirSync(storeDir, { recursive: true });

  const tilemakerArgs = [
    '--input',
    `/data/merged/${mergedPath.split(/[/\\]/).pop()}`,
    '--output',
    `/data/output/${outputFile}`,
    '--bbox',
    formatBboxArg(plan.bbox),
    '--config',
    configMount,
    '--process',
    '/usr/src/app/resources/process-openmaptiles.lua',
    '--store',
    `/data/store/${plan.id}`,
    '--shard-stores',
    ...tilemakerExtraArgs(),
  ];

  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${join(repoRoot, 'data', 'tiles')}:/data`,
      '-v',
      `${configHost}:${configMount}:ro`,
      tilemakerImage,
      ...tilemakerArgs,
    ],
    { stdio: verbose ? 'inherit' : 'pipe', cwd: repoRoot },
  );

  if (result.status !== 0) {
    const err = result.stderr?.toString() ?? 'tilemaker failed';
    console.error(err);
    throw new Error(`tilemaker:${plan.id} exit ${result.status}`);
  }
  stage.done();
}

/** @param {string} rel */
function ensureMbtiles(rel, plan) {
  const abs = join(repoRoot, rel);
  if (existsSync(abs)) {
    reporter.log(`[tiles:build] skip ${basename(rel)} (уже есть)`);
    return;
  }
  runTilemaker({ ...plan, outputRel: rel });
}

/** @param {string} targetRel @param {string} sourceRel */
function copyThemeMbtiles(targetRel, sourceRel) {
  const target = join(repoRoot, targetRel);
  if (existsSync(target)) {
    reporter.log(`[tiles:build] skip ${basename(targetRel)} (уже есть)`);
    return;
  }
  const source = join(repoRoot, sourceRel);
  if (!existsSync(source)) {
    throw new Error(`Нет исходника для копии: ${sourceRel}`);
  }
  reporter.log(`[tiles:build] ${basename(targetRel)} ← копия ${basename(sourceRel)}`);
  copyFileSync(source, target);
}

const TILESERVER_GL_IMAGE = 'maptiler/tileserver-gl:latest';

/** Noto glyphs для подписей НП (~2 MiB) — копируем из образа TileServer, если ещё нет. */
function ensureTileserverFonts() {
  const fontsDir = join(outputDir, 'fonts');
  const notoDir = join(fontsDir, 'Noto Sans Regular');
  if (existsSync(notoDir)) return;

  mkdirSync(fontsDir, { recursive: true });
  reporter.log('[tiles:build] fonts: копируем Noto из tileserver-gl…');

  const container = `radar-fonts-extract-${Date.now()}`;
  const create = spawnSync('docker', ['create', '--name', container, TILESERVER_GL_IMAGE], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  if (create.status !== 0) {
    throw new Error(`docker create fonts: ${create.stderr?.toString() ?? 'failed'}`);
  }

  try {
    const cp = spawnSync(
      'docker',
      [
        'cp',
        `${container}:/usr/src/app/node_modules/tileserver-gl-styles/fonts/.`,
        fontsDir,
      ],
      { cwd: repoRoot, stdio: verbose ? 'inherit' : 'pipe' },
    );
    if (cp.status !== 0) {
      throw new Error(`docker cp fonts: ${cp.stderr?.toString() ?? 'failed'}`);
    }
  } finally {
    spawnSync('docker', ['rm', container], { cwd: repoRoot, stdio: 'pipe' });
  }
}

function writeTileserverConfig() {
  const tm = manifest.tilemaker;
  const bbox = tm?.overview?.bbox ?? tm?.bbox ?? DEFAULT_BBOX;
  const overviewLight = basename(manifest.themes.light.mbtiles);
  const overviewDark = basename(manifest.themes.dark.mbtiles);
  const detailLight = manifest.themes.light.mbtilesDetail
    ? basename(manifest.themes.light.mbtilesDetail)
    : null;
  const detailDark = manifest.themes.dark.mbtilesDetail
    ? basename(manifest.themes.dark.mbtilesDetail)
    : null;

  /** @type {Record<string, { mbtiles: string }>} */
  const data = {
    light: { mbtiles: overviewLight },
    dark: { mbtiles: overviewDark },
  };
  if (detailLight) data['light-detail'] = { mbtiles: detailLight };
  if (detailDark) data['dark-detail'] = { mbtiles: detailDark };

  const config = {
    options: {
      paths: {
        root: '/data',
        fonts: '/data/fonts',
        sprites: '/data/sprites',
        styles: '/data/styles',
        mbtiles: '/data',
      },
      serveAllFonts: true,
    },
    data,
    styles: {
      light: {
        style: 'light.json',
        tilejson: { format: 'pbf', bounds: bbox },
      },
      dark: {
        style: 'dark.json',
        tilejson: { format: 'pbf', bounds: bbox },
      },
    },
  };

  const stylesDir = join(outputDir, 'styles');
  mkdirSync(stylesDir, { recursive: true });
  mkdirSync(join(outputDir, 'sprites'), { recursive: true });
  ensureTileserverFonts();

  for (const [theme, rel] of Object.entries(TILESERVER_STYLE)) {
    const src = join(repoRoot, rel);
    if (!existsSync(src)) {
      throw new Error(`Нет стиля TileServer: ${rel}`);
    }
    copyFileSync(src, join(stylesDir, `${theme}.json`));
  }
  writeFileSync(join(repoRoot, manifest.tileserver.configPath), JSON.stringify(config, null, 2));
}

function main() {
  reporter.log('\x1b[36m=== tiles:build ===\x1b[0m');

  if (!existsSync(mergedPath)) {
    throw new Error(`Нет ${manifest.merge.outputPath}. Запустите: npm run tiles:merge`);
  }

  mkdirSync(outputDir, { recursive: true });
  if (existsSync(storeRoot)) {
    reporter.log('[tiles:build] cleanup store/ перед сборкой (mmap ≠ mbtiles)');
    rmSync(storeRoot, { recursive: true, force: true });
  }
  const plans = resolveTilemakerPlans();
  const overviewPlan = plans.find((p) => p.id === 'overview' || p.id === 'single');
  const detailPlan = plans.find((p) => p.id === 'detail-west');

  if (!overviewPlan) {
    throw new Error('Нет плана overview/single для сборки');
  }

  ensureMbtiles(manifest.themes.light.mbtiles, overviewPlan);
  if (detailPlan && manifest.themes.light.mbtilesDetail) {
    ensureMbtiles(manifest.themes.light.mbtilesDetail, detailPlan);
  }

  copyThemeMbtiles(manifest.themes.dark.mbtiles, manifest.themes.light.mbtiles);
  if (manifest.themes.dark.mbtilesDetail && manifest.themes.light.mbtilesDetail) {
    copyThemeMbtiles(manifest.themes.dark.mbtilesDetail, manifest.themes.light.mbtilesDetail);
  }

  writeTileserverConfig();
  cleanupTilemakerStore();
  reporter.log(`\x1b[32mtiles:build → ${manifest.tileserver.configPath}\x1b[0m`);
}

/** Промежуточный store tilemaker (mmap_*.dat) — не артефакт; после сборки сотни GB. */
function cleanupTilemakerStore() {
  if (!existsSync(storeRoot)) return;
  reporter.log('[tiles:build] cleanup store/ (промежуточные mmap, не mbtiles)');
  rmSync(storeRoot, { recursive: true, force: true });
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
