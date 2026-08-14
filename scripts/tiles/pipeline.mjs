#!/usr/bin/env node
/**
 * SSOT шагов basemap tiles: build-артефакты → data/tiles/output и TileServer GL (profile app).
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

const COMPOSE_PROFILE_APP = ['compose', '--profile', 'app'];

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

/** Поднять TileServer и перезагрузить config (идемпотентно). */
export function runTileServerEnsure() {
  run('docker', ['compose', ...COMPOSE_PROFILE_APP, 'up', '-d', 'tiles']);
  run('docker', ['compose', ...COMPOSE_PROFILE_APP, 'restart', 'tiles']);
}

/** @deprecated используй runTileServerEnsure */
export function runTileServerUp() {
  runTileServerEnsure();
}

/** Перезапуск после tiles:sync — подхват config.json из data/tiles/output. */
export function runTileServerRestart() {
  run('docker', ['compose', ...COMPOSE_PROFILE_APP, 'restart', 'tiles']);
}

/** Остановить только сервис tiles (Postgres / app не трогаем). */
export function runTileServerDown() {
  run('docker', ['compose', ...COMPOSE_PROFILE_APP, 'stop', 'tiles']);
}

/** @returns {string} */
export function tileServerUrl() {
  return `http://127.0.0.1:${process.env.TILES_PORT ?? 8081}`;
}
