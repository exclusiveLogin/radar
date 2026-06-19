#!/usr/bin/env node
/**
 * radar — единая точка входа для операций монорепы.
 *
 *   npm run radar -- <domain> <action> [-- флаги...]
 *   npm run radar -- help [domain]
 *
 * Старые npm-скрипты остаются как алиасы; SSOT — этот диспетчер.
 */
import { run } from './utils.mjs';

const argv = process.argv.slice(2);

/** @param {string} ws @param {string} script @param {string[]} pass */
function npmW(ws, script, pass = []) {
  const args = ['run', script, '-w', ws];
  if (pass.length) args.push('--', ...pass);
  run('npm', args);
}

/** @param {string} script @param {string[]} pass */
function npm(script, pass = []) {
  const args = ['run', script];
  if (pass.length) args.push('--', ...pass);
  run('npm', args);
}

/** @param {string[]} pass */
function nodeScript(rel, pass = []) {
  run('node', [rel, ...pass]);
}

function splitPass(rest) {
  const dash = rest.indexOf('--');
  if (dash === -1) return { head: rest, pass: [] };
  return { head: rest.slice(0, dash), pass: rest.slice(dash + 1) };
}

const TOPICS = {
  stack: `
stack — инфраструктура и dev
  up              docker + dev:app
  dev [--full]    UI+API [+worker]
  cold-up         первый холодный старт
  db:up | db:down docker compose
  migrate         migration:run
`,
  pipeline: `
pipeline — очереди, drain, диагностика parse/geo
  status | drain | rebuild | rebuild:drain
  ingest:drain | geo:drain | queue:ingest | queue:geo | runs
  audit           channel parse audit (--channel, --random)
  parity          SQL inventory raw→locations
  reset           сброс parsed (raw остаётся)
  clear           полный сброс контента (конфиг остаётся)
  clear:raw | clear:ingest
  workspace:heal | catalog:heal | catalog:heal:audit
  processors:list | processors:validate
`,
  ingest: `
ingest — каналы и backfill
  backfill        CLI пачка (--all-bindings, --batch-size)
  drain           scheduled ingest drain
  manifest:import | manifest:export
  session:deploy | session:probe | session:invalidate
`,
  parse: `
parse — офлайн и фаза
  snap | snap:ollama | report
  run             rebuild:drain (основной прогон)
`,
  geo: `
geo — каталог и артефакты
  catalog:import | catalog:plan | catalog:reset
  vendor | vendor:pull | sync | verify
  layout | front-regions
  drain | check | recover
`,
  phase: `
phase — фазовый lifecycle (wipe/reset/clear)
  wipe <ingest|parse|geo|geo-catalog|ingest-parse|vendor-ingest-parse-geo>
  reset <ingest|parse|geo>
  clear <ingest|geo|all>
  manifest:import | manifest:export
`,
  map: `
map — read-side fold
  fold            fold snapshot status
  diagnose        map state debug
`,
  data: `
data — миграции и полный сброс
  migrate         migration:run
  reset           system:reset (--confirm, --wipe-only)
`,
  dev: `
dev — утилиты разработчика
  ws-smoke        проверка WS карты
  heap:diff       diff heap snapshots
`,
};

function printHelp(topic) {
  if (topic && TOPICS[topic]) {
    console.log(TOPICS[topic].trim());
    return;
  }
  console.log(`
radar — операции Radar (корень репо)

  npm run radar -- <domain> <action> [-- флаги...]
  npm run radar -- help [stack|pipeline|ingest|parse|geo|phase|map|data|dev]

Домены: stack pipeline ingest parse geo phase map data dev

Примеры:
  npm run radar -- stack dev --full
  npm run radar -- pipeline status
  npm run radar -- pipeline parity
  npm run radar -- ingest backfill -- --all-bindings --batch-size=100
  npm run radar -- geo catalog:import
  npm run radar -- phase wipe parse -- --dry-run
  npm run radar -- map diagnose

Подробнее: docs/radar-cli.md
`.trim());
}

/** @type {Record<string, Record<string, (pass: string[]) => void>>} */
const ACTIONS = {
  stack: {
    up: () => npm('up'),
    dev: (pass) => (pass.includes('--full') ? npm('dev', pass.filter((a) => a !== '--full')) : npm('dev:app', pass)),
    'cold-up': (pass) => nodeScript('scripts/cold-up.mjs', pass),
    'db:up': () => npm('db:up'),
    'db:down': () => npm('db:down'),
    migrate: () => npm('migration:run'),
  },
  pipeline: {
    status: (p) => npmW('@radar/worker', 'parse-engine:status', p),
    drain: (p) => npmW('@radar/worker', 'parse-engine:drain', p),
    rebuild: (p) => npmW('@radar/worker', 'parse-engine:rebuild', p),
    'rebuild:drain': (p) => npmW('@radar/worker', 'parse-engine:rebuild:drain', p),
    'ingest:drain': (p) => npmW('@radar/worker', 'parse-engine:ingest:drain', p),
    'geo:drain': (p) => npmW('@radar/worker', 'parse-engine:geo:drain', p),
    'queue:ingest': (p) => npmW('@radar/worker', 'parse-engine:queue:ingest', p),
    'queue:geo': (p) => npmW('@radar/worker', 'parse-engine:queue:geo', p),
    runs: (p) => npmW('@radar/worker', 'parse-engine:runs:status', p),
    audit: (p) => npmW('@radar/worker', 'parse-engine:channel:audit', p),
    parity: (p) => npmW('@radar/worker', 'parse-engine:parity:inventory', p),
    reset: (p) => npmW('@radar/worker', 'parse-engine:pipeline:reset', p),
    clear: (p) => npmW('@radar/worker', 'parse-engine:archive:clear', p),
    'clear:raw': (p) => npmW('@radar/worker', 'parse-engine:clear:raw', p),
    'clear:ingest': (p) => npmW('@radar/worker', 'parse-engine:clear:ingest', p),
    'workspace:heal': (p) => npmW('@radar/worker', 'parse-engine:workspace:heal', p),
    'catalog:heal': (p) => npmW('@radar/worker', 'parse-engine:catalog:heal', p),
    'catalog:heal:audit': (p) => npmW('@radar/worker', 'parse-engine:catalog:heal:audit', p),
    'processors:list': (p) => npmW('@radar/worker', 'parse-engine:processors:list', p),
    'processors:validate': (p) => npmW('@radar/worker', 'parse-engine:processors:validate', p),
    'phase:run': (p) => npmW('@radar/worker', 'parse-engine:phase:run', p),
    'phase:stop': (p) => npmW('@radar/worker', 'parse-engine:phase:stop', p),
  },
  ingest: {
    backfill: (p) => npmW('@radar/worker', 'parse-engine:ingest:backfill', p),
    drain: (p) => npmW('@radar/worker', 'parse-engine:ingest:drain', p),
    'manifest:import': (p) => npmW('@radar/worker', 'ingest:manifest:import', p),
    'manifest:export': (p) => npmW('@radar/worker', 'ingest:manifest:export', p),
    'session:deploy': (p) => npmW('@radar/worker', 'worker:session:deploy', p),
    'session:probe': (p) => npmW('@radar/worker', 'worker:session:probe', p),
    'session:invalidate': (p) => npmW('@radar/worker', 'worker:session:invalidate', p),
  },
  parse: {
    snap: (p) => npmW('@radar/worker', 'parse:snap', p),
    'snap:ollama': (p) => npmW('@radar/worker', 'parse:snap:ollama', p),
    report: (p) => npmW('@radar/worker', 'parse:report', p),
    run: (p) => npmW('@radar/worker', 'parse-engine:rebuild:drain', p),
  },
  geo: {
    'catalog:import': (p) => npmW('@radar/api', 'geo:catalog:import', p),
    'catalog:plan': (p) => npmW('@radar/api', 'geo:catalog:plan', p),
    'catalog:reset': (p) => npmW('@radar/api', 'geo:catalog:reset', p),
    vendor: (p) => npm('geo:vendor', p),
    'vendor:pull': (p) => npm('geo:vendor:pull', p),
    sync: (p) => npm('geo:sync', p),
    verify: (p) => npm('geo:verify', p),
    layout: (p) => npm('geo:layout:build', p),
    'front-regions': (p) => npm('geo:front-regions:build', p),
    drain: (p) => npmW('@radar/worker', 'parse-engine:geo:drain', p),
    check: (p) => npmW('@radar/worker', 'parse-engine:geo:check', p),
    recover: (p) => npmW('@radar/worker', 'parse-engine:geo:recover', p),
  },
  phase: {
    wipe: (p) => npmW('@radar/worker', 'phase:lifecycle', ['wipe', ...p]),
    reset: (p) => npmW('@radar/worker', 'phase:lifecycle', ['reset', ...p]),
    clear: (p) => npmW('@radar/worker', 'phase:lifecycle', ['clear', ...p]),
    'manifest:import': (p) => npm('phase:manifest:import', p),
    'manifest:export': (p) => npm('phase:manifest:export', p),
  },
  map: {
    fold: (p) => npmW('@radar/worker', 'map:fold:status', p),
    diagnose: (p) => npmW('@radar/worker', 'worker:map-state:diagnose', p),
  },
  data: {
    migrate: () => npm('migration:run'),
    reset: (p) => nodeScript('scripts/system-reset.mjs', p),
  },
  dev: {
    'ws-smoke': (p) => nodeScript('scripts/ws-smoke.mjs', p),
    'heap:diff': (p) => nodeScript('scripts/heap-snapshot-diff.mjs', p),
  },
};

function dispatch(domain, action, pass) {
  const group = ACTIONS[domain];
  if (!group) {
    console.error(`Неизвестный домен: ${domain}`);
    printHelp();
    process.exit(1);
  }
  const fn = group[action];
  if (!fn) {
    console.error(`Неизвестное действие: ${domain} ${action}`);
    if (TOPICS[domain]) console.log(TOPICS[domain].trim());
    process.exit(1);
  }
  fn(pass);
}

function main() {
  if (!argv.length || argv[0] === 'help' || argv[0] === '-h' || argv[0] === '--help') {
    printHelp(argv[1]);
    return;
  }

  const { head, pass } = splitPass(argv);
  const [domain, action, ...phaseTail] = head;

  // phase wipe parse → phase:lifecycle wipe parse
  if (domain === 'phase' && (action === 'wipe' || action === 'reset' || action === 'clear')) {
    const target = phaseTail[0];
    if (!target) {
      console.error(`Укажите фазу: npm run radar -- phase ${action} <ingest|parse|geo|...>`);
      process.exit(1);
    }
    dispatch(domain, action, [target, ...phaseTail.slice(1), ...pass]);
    return;
  }

  if (!action) {
    if (TOPICS[domain]) {
      console.log(TOPICS[domain].trim());
      return;
    }
    console.error(`Укажите действие: npm run radar -- ${domain} <action>`);
    process.exit(1);
  }

  dispatch(domain, action, [...phaseTail, ...pass]);
}

main();
