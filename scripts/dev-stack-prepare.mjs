#!/usr/bin/env node
/**
 * Pre-stack: собрать только library packages с dist (watch api/web/worker их читают).
 * Флаг: --no-clean — не удалять dist перед build.
 */
import { existsSync, rmSync } from 'node:fs';
import { run } from './utils.mjs';

const argv = process.argv.slice(2);
const cleanDist = !argv.includes('--no-clean');

/** Пакеты с main/types → dist; api/web/worker в docker:dev идут через nest/tsx watch. */
const LIBS = [
  '@radar/shared',
  '@radar/observability',
  '@radar/persistence',
  '@radar/transport-rmq',
  '@repo/root',
];

const DIST_DIRS = [
  'packages/shared/dist',
  'packages/observability/dist',
  'packages/persistence/dist',
  'packages/transport-rmq/dist',
];

function main() {
  console.log('\x1b[36m=== dev:prepare (libs) ===\x1b[0m');

  if (cleanDist) {
    for (const rel of DIST_DIRS) {
      if (existsSync(rel)) {
        rmSync(rel, { recursive: true, force: true });
        console.log(`[dev:prepare] removed ${rel}`);
      }
    }
  }

  for (const ws of LIBS) {
    console.log(`[dev:prepare] build ${ws}...`);
    run('npm', ['run', 'build', '-w', ws]);
  }

  console.log('\x1b[32mdev:prepare completed\x1b[0m');
}

main();
