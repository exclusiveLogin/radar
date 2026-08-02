#!/usr/bin/env node
/**
 * Host infra: PostgreSQL, RabbitMQ, Adminer, pgAdmin.
 * Опционально: --obs, --llm, --llm-ui.
 *
 * Не поднимает api/web/workers (это host `dev` или `docker:dev`).
 */
import { spawnSync } from 'node:child_process';
import { run } from './utils.mjs';

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
const withObs = argv.includes('--obs') || envTruthy('RADAR_DEV_WITH_OBS');

dockerOk();

console.log('[infra] docker compose up -d  (db, rabbitmq, adminer, pgadmin)');
run('docker', ['compose', 'up', '-d']);

if (withLlm || withLlmUi) {
  console.log('[infra] docker compose --profile llm up -d');
  run('docker', ['compose', '--profile', 'llm', 'up', '-d']);
}
if (withLlmUi) {
  console.log('[infra] docker compose --profile llm-ui up -d');
  run('docker', ['compose', '--profile', 'llm-ui', 'up', '-d']);
}

if (withObs) {
  console.log('[infra] docker compose --profile obs up -d');
  run('docker', ['compose', '--profile', 'obs', 'up', '-d']);
}

console.log('[infra] ready');
