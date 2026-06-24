#!/usr/bin/env node
/**
 * Сборка vector mbtiles через tilemaker (Docker) + TileServer GL (рендер PNG из vector).
 */
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
const storeDir = join(repoRoot, 'data', 'tiles', 'store');
const lightPath = join(repoRoot, manifest.themes.light.mbtiles);
const darkPath = join(repoRoot, manifest.themes.dark.mbtiles);

const DEFAULT_TILEMAKER_CONFIG = 'data/geo/tilemaker-rf-ua.json';
const DEFAULT_BBOX = [19, 41, 180, 82];
const TILESERVER_STYLE = {
  light: 'data/geo/tileserver-style-light.json',
  dark: 'data/geo/tileserver-style-dark.json',
};

/** @returns {{ configHost: string, configInContainer: string, bbox: [number, number, number, number] }} */
function resolveTilemakerOptions() {
  const configRel = manifest.tilemaker?.configPath?.trim() || DEFAULT_TILEMAKER_CONFIG;
  const configHost = join(repoRoot, configRel);
  if (!existsSync(configHost)) {
    throw new Error(`Нет tilemaker config: ${configRel}`);
  }
  const bbox = manifest.tilemaker?.bbox ?? DEFAULT_BBOX;
  return { configHost, configInContainer: '/data/tilemaker-config.json', bbox };
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

function runTilemaker(outputFile) {
  const stage = reporter.startStage(`tilemaker:${outputFile}`, 0);
  const { configHost, configInContainer, bbox } = resolveTilemakerOptions();
  reporter.log(`[tiles:build] tilemaker → ${outputFile}`);
  reporter.logVerbose(`image: ${tilemakerImage}`);
  reporter.logVerbose(`bbox: ${formatBboxArg(bbox)}`);

  mkdirSync(storeDir, { recursive: true });
  if (existsSync(storeDir)) {
    rmSync(storeDir, { recursive: true, force: true });
    mkdirSync(storeDir, { recursive: true });
  }

  /** Entrypoint образа уже вызывает /usr/src/app/tilemaker — не дублировать argv[0] «tilemaker». */
  const tilemakerArgs = [
    '--input',
    `/data/merged/${mergedPath.split(/[/\\]/).pop()}`,
    '--output',
    `/data/output/${outputFile}`,
    '--bbox',
    formatBboxArg(bbox),
    '--config',
    configInContainer,
    '--process',
    '/usr/src/app/resources/process-openmaptiles.lua',
    '--store',
    '/data/store',
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
      `${configHost}:${configInContainer}:ro`,
      tilemakerImage,
      ...tilemakerArgs,
    ],
    { stdio: verbose ? 'inherit' : 'pipe', cwd: repoRoot },
  );

  if (result.status !== 0) {
    const err = result.stderr?.toString() ?? 'tilemaker failed';
    console.error(err);
    throw new Error(
      `tilemaker exit ${result.status}\n` +
        `Проверьте bbox/config (shapefile-слои убраны в data/geo/tilemaker-rf-ua.json).`,
    );
  }
  stage.done();
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
  const { bbox } = resolveTilemakerOptions();
  const lightName = lightPath.split(/[/\\]/).pop();
  const darkName = darkPath.split(/[/\\]/).pop();
  const config = {
    options: {
      paths: {
        root: '/data',
        fonts: '/data/fonts',
        sprites: '/data/sprites',
        styles: '/data/styles',
        mbtiles: '/data',
      },
      // MapLibre glyphs (/fonts/...) — иначе 400 «Font not allowed» (шрифт не в server style).
      serveAllFonts: true,
    },
    data: {
      light: { mbtiles: lightName },
      dark: { mbtiles: darkName },
    },
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

  if (!existsSync(lightPath)) {
    runTilemaker(lightPath.split(/[/\\]/).pop());
  } else {
    reporter.log(`[tiles:build] skip light (уже есть)`);
  }

  if (!existsSync(darkPath)) {
    if (existsSync(lightPath)) {
      reporter.log('[tiles:build] dark ← копия light (временно; отдельный night-профиль — позже)');
      copyFileSync(lightPath, darkPath);
    } else {
      runTilemaker(darkPath.split(/[/\\]/).pop());
    }
  } else {
    reporter.log(`[tiles:build] skip dark (уже есть)`);
  }

  writeTileserverConfig();
  reporter.log(`\x1b[32mtiles:build → ${manifest.tileserver.configPath}\x1b[0m`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
