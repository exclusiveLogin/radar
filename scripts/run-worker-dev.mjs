#!/usr/bin/env node
/** Dev-worker с явной RADAR_WORKER_ROLE (один процесс = одна роль). */
import { spawn } from 'node:child_process';
import { repoRoot } from './utils.mjs';

const role = process.argv[2];
const allowed = new Set(['ingest', 'backfill', 'parse', 'geo', 'tracking']);
if (!role || !allowed.has(role)) {
  console.error(`Usage: node scripts/run-worker-dev.mjs <ingest|backfill|parse|geo|tracking>`);
  process.exit(1);
}

const child = spawn('npm', ['run', 'dev', '-w', '@radar/worker', '--ignore-scripts'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, RADAR_WORKER_ROLE: role },
});
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});