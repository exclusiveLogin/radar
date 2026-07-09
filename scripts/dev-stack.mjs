#!/usr/bin/env node
/**
 * Dev-стек с упорядоченным bootstrap:
 * Сборка dist — npm predev / predev:app / preworker:dev (корень package.json).
 * Параллельно: shared:watch, api dev, web (после /api/ready), [worker после dist].
 *
 * concurrently не имеет depends — порядок через wait-on в командах.
 * npm run dev:app | npm run dev (--full)
 */
import { loadDeploymentManifest } from '@radar/shared/deployment/deploymentManifest.loader.js';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { freeDevPorts } from './free-dev-ports.mjs';
import { repoRoot, run } from './utils.mjs';

function envTruthy(name) {
  const raw = process.env[name];
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** Поднять obs-service sidecar — manifest.infra.obs.dockerize / dockerizeAll. */
function ensureObsDockerStack() {
  const manifest = loadDeploymentManifest({ repoRoot });
  const obs = manifest.infra.obs;
  if (!obs.dockerize && !obs.dockerizeAll) return;
  console.log('[obs] docker compose --profile obs up -d');
  run('docker', ['compose', '--profile', 'obs', 'up', '-d']);
  process.env.RADAR_OBS_SERVICE_URL = obs.serviceUrl;
  process.env.OBS_PORT = String(obs.port);
  process.env.OBS_HOST = obs.host;
}

const full = process.argv.includes('--full');
const sharedDist = 'file:packages/shared/dist/index.js';
const apiDistMain = 'file:packages/api/dist/main.js';
const workerParseDist =
  'file:packages/worker/dist/application/parse/parsePipeline.worker.js';
/** Readiness: порт + БД, чтобы фронт не ловил ECONNREFUSED на /api/map/snapshot. */
const apiReady = 'http://127.0.0.1:3000/api/ready';
const waitTimeoutMs = 120_000;

const commands = [
  'npm run dev -w @radar/shared',
  `npx wait-on -t ${waitTimeoutMs} ${sharedDist} && npm run dev -w @radar/api`,
  `npx wait-on -t ${waitTimeoutMs} ${apiReady} && npm run dev -w @radar/web`,
];
if (full) {
  // Worker ждёт api/ready (nest watch уже собрал dist), не только файл с predev —
  // иначе гонка: worker стартует, пока api:dev ещё пересобирает/чистит dist.
  commands.push(
    `npx wait-on -t ${waitTimeoutMs} ${apiReady} ${workerParseDist} && node scripts/free-worker-probe-port.mjs && npm run dev -w @radar/worker --ignore-scripts`,
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

  freeDevPorts();

  ensureObsDockerStack();

  console.log('\n\x1b[36m(dist уже собран predev — см. package.json)\x1b[0m');
  console.log('\n\x1b[32mЗапуск процессов (web и worker после /api/ready)\x1b[0m');
  console.log(
    '\x1b[33mПервый старт 40–90с: predev (shared+api+worker), потом api → web → worker. Не закрывай терминал.\x1b[0m',
  );
  console.log('\x1b[90mТолько UI без worker: npm run dev:app\x1b[0m\n');
  spawnConcurrently();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
