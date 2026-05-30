#!/usr/bin/env node
/**
 * Dev-стек с упорядоченным bootstrap:
 * 1) сборка @radar/shared (блокирующе)
 * 2) параллельно: shared:watch, api (после dist), web (после /api/ready), [worker]
 *
 * concurrently не имеет depends — порядок через wait-on в командах.
 * npm run dev:app | npm run dev (--full)
 */
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { repoRoot, run } from './utils.mjs';

const full = process.argv.includes('--full');
const sharedDist = 'file:packages/shared/dist/index.js';
/** Readiness: порт + БД, чтобы фронт не ловил ECONNREFUSED на /api/map/snapshot. */
const apiReady = 'http://127.0.0.1:3000/api/ready';
const waitTimeoutMs = 120_000;

const commands = [
  'npm run dev -w @radar/shared',
  `npx wait-on -t ${waitTimeoutMs} ${sharedDist} && npm run dev -w @radar/api`,
  `npx wait-on -t ${waitTimeoutMs} ${apiReady} && npm run dev -w @radar/web`,
];
if (full) {
  commands.push(
    `npx wait-on -t ${waitTimeoutMs} ${sharedDist} && npm run dev -w @radar/worker`,
  );
}

const names = full ? 'shared,api,web,worker' : 'shared,api,web';
const colors = full ? 'cyan,blue,magenta,green' : 'cyan,blue,magenta';

function spawnConcurrently() {
  // Каждая команда — один аргумент concurrently; на Windows обязательны кавычки.
  const quoted = commands.map((cmd) => JSON.stringify(cmd)).join(' ');
  const line = `npx concurrently -n ${names} -c ${colors} ${quoted}`;

  const child = spawn(line, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
}

async function main() {
  console.log('\x1b[36m=== Radar dev: bootstrap ===\x1b[0m');
  console.log(`Профиль: ${full ? 'full (+ worker)' : 'app (shared + api + web)'}`);

  console.log('\n\x1b[32m[1/2] build @radar/shared\x1b[0m');
  run('npm', ['run', 'build', '-w', '@radar/shared']);

  console.log('\n\x1b[32m[2/2] процессы (web стартует после /api/ready)\x1b[0m');
  spawnConcurrently();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
