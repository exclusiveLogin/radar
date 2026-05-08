#!/usr/bin/env node
// Холодный старт: Docker (Postgres + pgAdmin), npm install, сборка @radar/shared, миграции.
// npm run cold:up  |  npm run cold:up -- -Geo -Dev -Llm -LlmUi  |  двойной дефис: -- --geo --dev --llm --llm-ui
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadRepoEnv, repoRoot, run } from './utils.mjs';

loadRepoEnv();

const argSet = new Set(
  process.argv.slice(2).map((a) => {
    const n = a.startsWith('--') ? a.slice(1) : a;
    return n.toLowerCase();
  }),
);
const geo = argSet.has('-geo');
const dev = argSet.has('-dev');
const llmFlag = argSet.has('-llm');
const llmUiFlag = argSet.has('-llm-ui');

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
    console.error(
      'Docker недоступен. Запустите Docker Desktop и повторите.',
    );
    process.exit(1);
  }
}

async function main() {
  console.log('\x1b[36m=== Radar: холодный старт ===\x1b[0m');
  console.log(`Каталог: ${repoRoot}`);

  if (!existsSync(join(repoRoot, '.env'))) {
    console.warn(
      '\x1b[33mНет файла .env — скопируйте .env.example в .env и при необходимости заполните (особенно DATABASE_URL).\x1b[0m',
    );
  }

  dockerOk();

  console.log('\n\x1b[32m[1/5] docker compose up -d\x1b[0m');
  run('docker', ['compose', 'up', '-d']);

  const pgUser = process.env.POSTGRES_USER || 'radar';
  const pgDb = process.env.POSTGRES_DB || 'radar';

  console.log('\n\x1b[32m[2/5] ожидание Postgres (pg_isready)...\x1b[0m');
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

  console.log('\n\x1b[32m[3/5] npm install\x1b[0m');
  run('npm', ['install']);

  console.log('\n\x1b[32m[4/5] сборка @radar/shared (нужна до dev/api)\x1b[0m');
  run('npm', ['run', 'build', '-w', '@radar/shared']);

  console.log('\n\x1b[32m[5/5] миграции TypeORM\x1b[0m');
  run('npm', ['run', 'migration:run']);

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

  if (geo) {
    console.log(
      '\n\x1b[33m[geo] vendor → sync → seed → db:apply (может занять время)\x1b[0m',
    );
    run('npm', ['run', 'geo:vendor']);
    run('npm', ['run', 'geo:sync']);
    run('npm', ['run', 'geo:seed']);
    run('npm', ['run', 'geo:db:apply']);
  }

  console.log('\n\x1b[36m=== Готово ===\x1b[0m');
  console.log(
    'Postgres: localhost:5432  |  pgAdmin: http://127.0.0.1:5050',
  );

  if (dev) {
    console.log('\n\x1b[32mЗапуск npm run dev ...\x1b[0m');
    run('npm', ['run', 'dev']);
  } else {
    console.log('\x1b[33mДальше: npm run dev\x1b[0m');
    console.log(
      '\x1b[90mФлаги: npm run cold:up -- -Geo -Dev -Llm -LlmUi  или  -- --geo --dev --llm --llm-ui\x1b[0m',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
