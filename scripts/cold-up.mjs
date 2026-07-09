#!/usr/bin/env node
// Холодный старт: Docker (Postgres + Adminer + pgAdmin), npm install, сборка @radar/shared, миграции.
// npm run cold:up  |  npm run cold:up -- -Geo -Dev -Llm -LlmUi  |  двойной дефис: -- --geo --dev --llm --llm-ui
import { loadDeploymentManifest } from '@radar/shared/deployment/deploymentManifest.loader.js';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRootCliReporter, parseCliFlags } from './cli-reporter.mjs';
import { loadRepoEnv, repoRoot, run } from './utils.mjs';

loadRepoEnv();

const argSet = new Set(
  process.argv.slice(2).map((a) => {
    const n = a.startsWith('--') ? a.slice(1) : a;
    return n.toLowerCase();
  }),
);

function envTruthy(name) {
  const raw = process.env[name];
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

const geo = argSet.has('-geo');
const tiles = argSet.has('-tiles') || envTruthy('COLD_UP_WITH_TILES');
const dev = argSet.has('-dev');
const llmFlag = argSet.has('-llm');
const llmUiFlag = argSet.has('-llm-ui');
const { verbose } = parseCliFlags();
const reporter = createRootCliReporter({ verbose });

function dockerOk() {
  const r = spawnSync('docker', ['info'], {
    stdio: 'ignore',
    env: process.env,
    shell: false,
  });
  if (r.status !== 0) {
    console.error(
      'Docker недоступен. Запустите Docker Desktop и повторите.',
    );
    process.exit(1);
  }
}

async function main() {
  console.log('\x1b[36m=== Radar: холодный старт ===\x1b[0m');
  console.log(`Каталог: ${repoRoot}`);

  const totalSteps = 6 + (geo ? 1 : 0) + (tiles ? 1 : 0);
  let step = 0;
  const progress = reporter.startStage('cold-up', totalSteps);

  if (!existsSync(join(repoRoot, '.env'))) {
    console.warn(
      '\x1b[33mНет файла .env — скопируйте .env.example в .env и при необходимости заполните (особенно DATABASE_URL).\x1b[0m',
    );
  }

  dockerOk();

  step += 1;
  console.log(`\n\x1b[32m[${step}/${totalSteps}] docker compose up -d\x1b[0m`);
  run('docker', ['compose', 'up', '-d']);
  progress.tick();

  const pgUser = process.env.POSTGRES_USER || 'radar';
  const pgDb = process.env.POSTGRES_DB || 'radar';

  step += 1;
  console.log(`\n\x1b[32m[${step}/${totalSteps}] ожидание Postgres (pg_isready)...\x1b[0m`);
  let ready = false;
  for (let i = 0; i < 45; i++) {
    const probe = spawnSync(
      'docker',
      ['compose', 'exec', '-T', 'db', 'pg_isready', '-U', pgUser, '-d', pgDb],
      {
        cwd: repoRoot,
        stdio: 'ignore',
        env: process.env,
        shell: false,
      },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await delay(2000);
  }
  if (!ready) {
    console.error(
      'База не поднялась за отведённое время. Проверьте: docker compose ps / docker compose logs db',
    );
    process.exit(1);
  }
  progress.tick();

  step += 1;
  console.log(`\n\x1b[32m[${step}/${totalSteps}] npm install\x1b[0m`);
  run('npm', ['install']);
  progress.tick();

  step += 1;
  console.log(`\n\x1b[32m[${step}/${totalSteps}] сборка @radar/shared и @repo/root\x1b[0m`);
  run('npm', ['run', 'build', '-w', '@radar/shared']);
  run('npm', ['run', 'build', '-w', '@repo/root']);
  progress.tick();

  step += 1;
  console.log(`\n\x1b[32m[${step}/${totalSteps}] миграции TypeORM\x1b[0m`);
  run('npm', ['run', 'migration:run']);
  progress.tick();

  const llm =
    llmFlag ||
    llmUiFlag ||
    envTruthy('RADAR_LLM_GEOCODER_ENABLED') ||
    envTruthy('COLD_UP_WITH_LLM');
  if (llm) {
    const model = (process.env.RADAR_LLM_MODEL || 'qwen2.5:3b').trim();
    console.log('\n\x1b[32m[llm] docker compose --profile llm up -d\x1b[0m');
    run('docker', ['compose', '--profile', 'llm', 'up', '-d']);
    console.log(`\n\x1b[32m[llm] ollama pull ${model}\x1b[0m`);
    run('docker', [
      'compose',
      '--profile',
      'llm',
      'exec',
      '-T',
      'ollama',
      'ollama',
      'pull',
      model,
    ]);
  }

  const llmUi = llmUiFlag || envTruthy('COLD_UP_WITH_LLM_UI');
  if (llmUi) {
    console.log('\n\x1b[32m[llm-ui] docker compose --profile llm-ui up -d\x1b[0m');
    run('docker', ['compose', '--profile', 'llm-ui', 'up', '-d']);
  }

  const deployment = loadDeploymentManifest({ repoRoot });
  const obs = deployment.infra.obs;
  if (obs.dockerize || obs.dockerizeAll) {
    console.log('[obs] docker compose --profile obs up -d');
    run('docker', ['compose', '--profile', 'obs', 'up', '-d']);
    process.env.RADAR_OBS_SERVICE_URL = obs.serviceUrl;
    process.env.OBS_PORT = String(obs.port);
    process.env.OBS_HOST = obs.host;
  }

  if (geo) {
    step += 1;
    console.log(
      `\n\x1b[33m[${step}/${totalSteps}] geo pipeline\x1b[0m`,
    );
    run('npm', ['run', 'geo:regions:seed']);
    run('npm', ['run', 'geo:vendor']);
    run('npm', ['run', 'geo:sync']);
    run('npm', ['run', 'geo:seed']);
    run('npm', ['run', 'geo:features:import']);
    progress.tick();
  }

  const tilesFlag = tiles || envTruthy('COLD_UP_WITH_TILES');
  if (tilesFlag) {
    step += 1;
    console.log(`\n\x1b[33m[${step}/${totalSteps}] tiles:init (долго)\x1b[0m`);
    const tilesArgs = verbose ? ['--verbose'] : [];
    run('node', ['scripts/tiles-init.mjs', ...tilesArgs]);
    progress.tick();
  }

  progress.done();

  console.log('\n\x1b[36m=== Готово ===\x1b[0m');
  console.log(
    'Postgres: localhost:5432  |  Adminer: http://127.0.0.1:8080  |  pgAdmin: http://127.0.0.1:5050',
  );
  if (tilesFlag) {
    console.log(`Tiles: http://127.0.0.1:${process.env.TILES_PORT ?? 8081}`);
  }

  if (dev) {
    console.log('\n\x1b[32mЗапуск npm run dev ...\x1b[0m');
    run('npm', ['run', 'dev']);
  } else {
    console.log('\x1b[33mДальше: npm run dev  |  Docker: npm run radar -- stack docker-dev\x1b[0m');
    console.log(
      '\x1b[90mФлаги: -Geo -Tiles -Dev -Verbose -Llm -LlmUi  или  -- --geo --tiles --dev --verbose\x1b[0m',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
