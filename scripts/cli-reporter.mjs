#!/usr/bin/env node
/**
 * SSOT verbose/quiet и stage progress для корневых Node-скриптов (cold-up, tiles:sync).
 */
import { spawnSync } from 'node:child_process';
import { createStageProgressReporter } from '@radar/shared';

/** @param {string[]} argv */
export function parseCliFlags(argv = process.argv.slice(2)) {
  const set = new Set(argv.map((a) => a.toLowerCase().replace(/^--/, '-')));
  const verbose =
    set.has('-verbose') ||
    set.has('-v') ||
    envTruthy(process.env.RADAR_CLI_VERBOSE);
  const quiet = set.has('-quiet') || set.has('-q');
  return { verbose: verbose && !quiet, quiet };
}

/** @param {string | undefined} raw */
function envTruthy(raw) {
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * @param {{ verbose?: boolean }} [options]
 */
export function createRootCliReporter(options = {}) {
  const verbose = options.verbose ?? false;
  const stages = createStageProgressReporter();

  return {
    verbose,
    /** @param {string} msg */
    log(msg) {
      console.log(msg);
    },
    /** @param {string} msg */
    logVerbose(msg) {
      if (verbose) console.log(`\x1b[90m${msg}\x1b[0m`);
    },
    /** @param {string} stage @param {number} total */
    startStage(stage, total) {
      return stages.start(stage, total);
    },
  };
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ verbose?: boolean, cwd?: string }} [options]
 */
export function runLogged(cmd, args, options = {}) {
  if (options.verbose) {
    console.log(`\x1b[90m> ${cmd} ${args.join(' ')}\x1b[0m`);
  }
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Команда завершилась с кодом ${result.status ?? 1}: ${cmd}`);
  }
}
