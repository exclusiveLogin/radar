#!/usr/bin/env node
/**
 * Host infra: default compose (Postgres, RabbitMQ, Prometheus, Grafana, Adminer, pgAdmin).
 * Опционально: --llm / --llm-ui; obs — из deployment manifest.
 *
 * Не поднимает api/web/workers (это host `dev` или `docker:dev`).
 */
import { loadDeploymentManifest } from '@radar/shared/deployment/deploymentManifest.loader.js';
import { spawnSync } from 'node:child_process';
import { repoRoot, run } from './utils.mjs';

function envTruthy(name) {
  const raw = process.env[name];
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function dockerOk() {
  const r = spawnSync('docker', ['info'], {
    stdio: 'ignore',
    env: process.env,
    shell: false,
  });
  if (r.status !== 0) {
    console.error('Docker недоступен. Запустите Docker Desktop и повторите.');
    process.exit(1);
  }
}

const argv = process.argv.slice(2).map((a) => a.toLowerCase());
const withLlm = argv.includes('--llm') || envTruthy('RADAR_DEV_WITH_LLM');
const withLlmUi = argv.includes('--llm-ui') || envTruthy('RADAR_DEV_WITH_LLM_UI');

dockerOk();

console.log('[infra] docker compose up -d  (db, rabbitmq, prometheus, grafana, adminer, pgadmin)');
run('docker', ['compose', 'up', '-d']);

if (withLlm || withLlmUi) {
  console.log('[infra] docker compose --profile llm up -d');
  run('docker', ['compose', '--profile', 'llm', 'up', '-d']);
}
if (withLlmUi) {
  console.log('[infra] docker compose --profile llm-ui up -d');
  run('docker', ['compose', '--profile', 'llm-ui', 'up', '-d']);
}

const manifest = loadDeploymentManifest({ repoRoot });
const obs = manifest.infra.obs;
if (obs.dockerize || obs.dockerizeAll) {
  console.log('[infra] docker compose --profile obs up -d');
  run('docker', ['compose', '--profile', 'obs', 'up', '-d']);
  process.env.RADAR_OBS_SERVICE_URL = obs.serviceUrl;
  process.env.OBS_PORT = String(obs.port);
  process.env.OBS_HOST = obs.host;
}

console.log('[infra] ready');
