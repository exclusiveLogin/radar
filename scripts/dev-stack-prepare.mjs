#!/usr/bin/env node
/**
 * Pre-stack bootstrap (host dev + docker:dev): clean dist → full build → потом процессы/compose.
 * Контейнеры и watch-режим dist не сносят.
 *
 * Флаги: --no-clean — build без rm.
 */
import { existsSync, rmSync } from 'node:fs';
import { run } from './utils.mjs';

const argv = process.argv.slice(2);
const cleanDist = !argv.includes('--no-clean');

const DIST_DIRS = ['packages/api/dist', 'packages/worker/dist'];

const BUILD_CHAIN = [
  '@radar/shared',
  '@radar/observability',
  '@repo/root',
  '@radar/api',
  '@radar/worker',
];

function main() {
  console.log('\x1b[36m=== dev:prepare (pre-stack) ===\x1b[0m');

  if (cleanDist) {
    console.log('[dev:prepare] clean dist...');
    for (const rel of DIST_DIRS) {
      if (existsSync(rel)) {
        rmSync(rel, { recursive: true, force: true });
        console.log(`[dev:prepare] removed ${rel}`);
      }
    }
  } else {
    console.log('[dev:prepare] --no-clean: dist не трогаем');
  }

  for (const ws of BUILD_CHAIN) {
    console.log(`[dev:prepare] build ${ws}...`);
    run('npm', ['run', 'build', '-w', ws]);
  }

  console.log('\x1b[32mdev:prepare completed\x1b[0m');
}

main();
