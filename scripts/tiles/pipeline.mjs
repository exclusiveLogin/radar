#!/usr/bin/env node
/**
 * SSOT шагов basemap tiles: build-артефакты и TileServer GL (compose profile tiles).
 */
import { spawnSync } from 'node:child_process';
import { repoRoot, run } from '../utils.mjs';

/** @type {ReadonlyArray<readonly [string, string]>} */
export const TILES_BUILD_STEPS = [
  ['download', 'scripts/tiles/download-osm.mjs'],
  ['merge', 'scripts/tiles/merge-osm.mjs'],
  ['build', 'scripts/tiles/build-tiles.mjs'],
  ['verify', 'scripts/tiles/verify-tiles.mjs'],
];

const COMPOSE_FILES = [
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.tiles.yml',
];

/**
 * @param {string} rel
 * @param {{ verbose?: boolean, extraArgs?: string[] }} [options]
 */
export function runTilesNodeScript(rel, options = {}) {
  const args = [...(options.extraArgs ?? [])];
  if (options.verbose) args.push('--verbose');
  const result = spawnSync('node', [rel, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/**
 * download → merge → build → verify (идемпотентно).
 * @param {{ verbose?: boolean, reporter?: { log: (s: string) => void, logVerbose?: (s: string) => void, startStage?: (n: string, t: number) => { tick: () => void, done: () => void } }, extraArgs?: string[] }} [options]
 */
export function runTilesBuildPipeline(options = {}) {
  const { verbose = false, reporter, extraArgs = [] } = options;
  const stage = reporter?.startStage?.('tiles:build', TILES_BUILD_STEPS.length);

  for (const [name, script] of TILES_BUILD_STEPS) {
    reporter?.log?.(`\n\x1b[36m[tiles] ${name}\x1b[0m`);
    reporter?.logVerbose?.(`> node ${script}`);
    runTilesNodeScript(script, { verbose, extraArgs });
    stage?.tick();
  }

  stage?.done();
}

/** Поднять TileServer GL (параллельно с host dev). */
export function runTileServerUp() {
  run('docker', ['compose', ...COMPOSE_FILES, '--profile', 'tiles', 'up', '-d']);
}

/** Остановить только сервис tiles (Postgres не трогаем). */
export function runTileServerDown() {
  run('docker', ['compose', ...COMPOSE_FILES, '--profile', 'tiles', 'stop', 'tiles']);
}

/** @returns {string} */
export function tileServerUrl() {
  return `http://127.0.0.1:${process.env.TILES_PORT ?? 8081}`;
}
