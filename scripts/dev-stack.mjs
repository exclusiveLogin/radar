#!/usr/bin/env node
/**
 * Host dev-стек: prepare → concurrently (shared/api/web + 5 workers по ролям).
 * --app-only: без workers.
 */
import { loadDeploymentManifest } from '@radar/shared/deployment/deploymentManifest.loader.js';
import { spawn } from 'node:child_process';
import { freeDevPorts } from './free-dev-ports.mjs';
import { repoRoot, run } from './utils.mjs';

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

const argv = process.argv.slice(2);
const appOnly = argv.includes('--app-only');
const prepareArgs = argv.includes('--no-clean') ? ['--no-clean'] : [];
const sharedDist = 'file:packages/shared/dist/index.js';
const workerParseDist =
  'file:packages/worker/dist/application/parse/parsePipeline.worker.js';
const apiReady = 'http://127.0.0.1:3000/api/ready';
const waitTimeoutMs = 120_000;
const WORKER_ROLES = ['ingest', 'backfill', 'parse', 'geo', 'tracking'];

const commands = [
  'npm run dev -w @radar/shared',
  `npx wait-on -t ${waitTimeoutMs} ${sharedDist} && npm run dev -w @radar/api`,
  `npx wait-on -t ${waitTimeoutMs} ${apiReady} && npm run dev -w @radar/web`,
];

if (!appOnly) {
  const workerWait = `npx wait-on -t ${waitTimeoutMs} ${apiReady} ${workerParseDist}`;
  for (const role of WORKER_ROLES) {
    const freeProbe = role === 'ingest' ? 'node scripts/free-worker-probe-port.mjs && ' : '';
    commands.push(`${freeProbe}${workerWait} && node scripts/run-worker-dev.mjs ${role}`);
  }
}

const names = appOnly
  ? 'shared,api,web'
  : 'shared,api,web,worker-ingest,worker-backfill,worker-parse,worker-geo,worker-tracking';
const colors = appOnly
  ? 'cyan,blue,magenta'
  : 'cyan,blue,magenta,green,yellow,red,white,gray';

function spawnConcurrently() {
  const quoted = commands.map((cmd) => JSON.stringify(cmd)).join(' ');
  const line = `npx concurrently -n ${names} -c ${colors} ${quoted}`;
  const child = spawn(line, { cwd: repoRoot, stdio: 'inherit', shell: true });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
}

async function main() {
  console.log('\x1b[36m=== Radar dev: bootstrap ===\x1b[0m');
  console.log(`Профиль: ${appOnly ? 'app-only (shared+api+web)' : 'full (5 workers by role)'}`);
  freeDevPorts();
  ensureObsDockerStack();
  run('node', ['scripts/dev-stack-prepare.mjs', ...prepareArgs]);
  console.log('\n\x1b[32mЗапуск процессов (web и workers после /api/ready)\x1b[0m');
  console.log('\x1b[90mТолько UI: npm run dev:app\x1b[0m\n');
  spawnConcurrently();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});