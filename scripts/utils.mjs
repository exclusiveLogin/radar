import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const scriptsDir = __dirname;
export const repoRoot = join(__dirname, '..');

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string; stdio?: 'inherit' | 'pipe' }} [opts]
 */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    stdio: opts.stdio ?? 'inherit',
    env: process.env,
    shell: false,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string }} [opts]
 */
export function runOutput(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    env: process.env,
    shell: false,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
  return r.stdout.trim();
}

/** Подмешивает корневой `.env` в `process.env` (не перезаписывает уже заданные переменные). */
export function loadRepoEnv() {
  const p = join(repoRoot, '.env');
  if (!existsSync(p)) return;
  const text = readFileSync(p, 'utf8');
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (v === '' || process.env[k] !== undefined) continue;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

export function loadGeoConfig() {
  const configPath = join(scriptsDir, 'geo-sources.json');
  if (!existsSync(configPath)) {
    console.error(`Нет ${configPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}
