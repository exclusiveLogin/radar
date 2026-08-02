#!/usr/bin/env node
/**
 * Host dev-стек: infra → prepare → concurrently (shared/api/web + workers).
 * --app-only: без workers.
 * --obs / --llm / --llm-ui: дополнительно observability / ollama (+ open-webui).
 * --no-infra: не трогать Docker (если infra уже поднята).
 */
import { loadDeploymentManifest } from '@radar/shared/deployment/deploymentManifest.loader.js';
import { spawn } from 'node:child_process';
import { freeDevPorts } from './free-dev-ports.mjs';
import { repoRoot, run } from './utils.mjs';
import {
  DEV_WORKER_COLORS,
  DEV_WORKER_PROBE_ROLE,
  DEV_WORKER_ROLES,
  devWorkerProcessNames,
} from './worker-roles.mjs';

const argv = process.argv.slice(2);
const appOnly = argv.includes('--app-only');
const noInfra = argv.includes('--no-infra');
const prepareArgs = argv.includes('--no-clean') ? ['--no-clean'] : [];
const infraArgs = [
  ...(argv.includes('--obs') ? ['--obs'] : []),
  ...(argv.includes('--llm') ? ['--llm'] : []),
  ...(argv.includes('--llm-ui') ? ['--llm-ui'] : []),
];
const libsReady =
  'file:packages/shared/dist/index.js file:packages/persistence/dist/index.js file:packages/transport-rmq/dist/index.js';
const waitTimeoutMs = 120_000;

const manifest = loadDeploymentManifest({ repoRoot });
const apiPort = Number(process.env.PORT) || manifest.infra.compose.apiPort;
const apiReady = `http://127.0.0.1:${apiPort}/api/ready`;

const commands = [
  'npm run dev -w @radar/shared',
  `npx wait-on -t ${waitTimeoutMs} ${libsReady} && npm run dev -w @radar/api`,
  `npx wait-on -t ${waitTimeoutMs} ${apiReady} && npm run dev -w @radar/web`,
];

if (!appOnly) {
  const workerWait = `npx wait-on -t ${waitTimeoutMs} ${apiReady} ${libsReady}`;
  for (const role of DEV_WORKER_ROLES) {
    const freeProbe =
      role === DEV_WORKER_PROBE_ROLE ? 'node scripts/free-worker-probe-port.mjs && ' : '';
    commands.push(`${freeProbe}${workerWait} && node scripts/run-worker-dev.mjs ${role}`);
  }
}

const appNames = ['shared', 'api', 'web'];
const appColors = ['cyan', 'blue', 'magenta'];
const names = (appOnly ? appNames : [...appNames, ...devWorkerProcessNames()]).join(',');
const colors = (appOnly ? appColors : [...appColors, ...DEV_WORKER_COLORS]).join(',');

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
  if (!noInfra) {
    run('node', ['scripts/infra-up.mjs', ...infraArgs]);
  } else {
    console.log('[infra] skipped (--no-infra)');
  }
  run('node', ['scripts/dev-stack-prepare.mjs', ...prepareArgs]);
  console.log('\n\x1b[32mЗапуск процессов (web и workers после /api/ready)\x1b[0m');
  console.log('\x1b[90mТолько UI: npm run dev:app | без Docker: --no-infra | наблюдаемость: --obs | LLM: --llm\x1b[0m\n');
  spawnConcurrently();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
