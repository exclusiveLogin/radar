#!/usr/bin/env node
/**
 * Проверка и освобождение портов dev-стека перед predev / dev-stack.
 * Windows: netstat + taskkill; Unix: lsof + kill.
 */
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { loadRepoEnv } from './utils.mjs';

loadRepoEnv();

/** Порты radar dev (из .env / vite / worker probe). */
function devPorts() {
  const raw = [
    Number(process.env.PORT) || 3000,
    Number(process.env.VITE_DEV_PORT) || 5173,
    Number(process.env.WORKER_PROBE_PORT) || 3010,
  ];
  return [...new Set(raw.filter((p) => Number.isInteger(p) && p > 0 && p < 65536))];
}

/** PID процессов, слушающих TCP-порт. */
function listeningPids(port) {
  if (platform() === 'win32') {
    const r = spawnSync('netstat', ['-ano'], {
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (r.status !== 0) return [];
    const re = new RegExp(`:${port}(?:\\s|$)[^\\n]*LISTENING\\s+(\\d+)`, 'i');
    const pids = new Set();
    for (const line of (r.stdout ?? '').split(/\r?\n/)) {
      const m = line.match(re);
      if (m) pids.add(Number(m[1]));
    }
    return [...pids].filter((pid) => pid > 0);
  }

  const r = spawnSync('lsof', [`-nP -iTCP:${port} -sTCP:LISTEN -t`], {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (r.status !== 0) return [];
  return (r.stdout ?? '')
    .split(/\s+/)
    .map((s) => Number(s.trim()))
    .filter((pid) => pid > 0);
}

/** Завершить процесс по PID. */
function killPid(pid) {
  if (platform() === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/F'], {
      stdio: 'ignore',
      shell: true,
    });
    return;
  }
  spawnSync('kill', ['-9', String(pid)], { stdio: 'ignore' });
}

function isPortFree(port) {
  return listeningPids(port).length === 0;
}

/** Освободить порт; вернуть число завершённых процессов. */
export function freePort(port) {
  const pids = listeningPids(port);
  if (pids.length === 0) return 0;

  const self = process.pid;
  let killed = 0;
  for (const pid of pids) {
    if (pid === self) continue;
    console.log(`\x1b[33m[ports] порт ${port} занят PID ${pid} — завершаем\x1b[0m`);
    killPid(pid);
    killed += 1;
  }
  return killed;
}

/** Все dev-порты: проверка + освобождение. */
export function freeDevPorts() {
  const ports = devPorts();
  console.log('\x1b[36m[ports] dev-порты:\x1b[0m', ports.join(', '));

  let totalKilled = 0;
  for (const port of ports) {
    totalKilled += freePort(port);
  }

  const blocked = ports.filter((p) => !isPortFree(p));
  if (blocked.length > 0) {
    console.error(
      `\x1b[31m[ports] не удалось освободить: ${blocked.join(', ')}\x1b[0m`,
    );
    process.exit(1);
  }

  if (totalKilled > 0) {
    console.log(
      `\x1b[32m[ports] освобождено процессов: ${totalKilled}\x1b[0m`,
    );
  } else {
    console.log('\x1b[90m[ports] все порты свободны\x1b[0m');
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return (
      fileURLToPath(import.meta.url) ===
      fileURLToPath(pathToFileURL(entry))
    );
  } catch {
    return entry.replace(/\\/g, '/').endsWith('scripts/free-dev-ports.mjs');
  }
}

if (isDirectRun()) {
  freeDevPorts();
}
