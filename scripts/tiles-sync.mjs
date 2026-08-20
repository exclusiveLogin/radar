#!/usr/bin/env node
/**
 * Basemap SSOT: download → merge → build → verify → (опц.) restart TileServer.
 * Идемпотентный skip на шагах pipeline. Заменяет бывшие tiles:init / tiles:update.
 *
 * Флаги:
 *   --no-restart   только артефакты в data/tiles/output (алиасы: --build-only, --no-up)
 *   --verbose
 */
import { createRootCliReporter, parseCliFlags } from './cli-reporter.mjs';
import {
  runTileServerRestart,
  runTilesBuildPipeline,
  tileServerUrl,
} from './tiles/pipeline.mjs';

const argv = process.argv.slice(2);
const { verbose } = parseCliFlags(argv);
const reporter = createRootCliReporter({ verbose });

/** @param {string[]} args */
function wantsNoRestart(args) {
  const flags = new Set(args.map((a) => a.toLowerCase()));
  return (
    flags.has('--no-restart') ||
    flags.has('--build-only') ||
    flags.has('--no-up')
  );
}

const noRestart = wantsNoRestart(argv);

async function main() {
  reporter.log('\x1b[36m=== stack tiles:sync ===\x1b[0m');
  reporter.log(
    '\x1b[90mАртефакты → data/tiles/output (volume TileServer в docker:dev)\x1b[0m',
  );

  const overall = reporter.startStage('tiles:sync', noRestart ? 1 : 2);
  runTilesBuildPipeline({ verbose, reporter });
  overall.tick();

  if (!noRestart) {
    reporter.log('\n\x1b[36m[tiles:sync] restart TileServer (подхват config.json)\x1b[0m');
    runTileServerRestart();
    overall.tick();
  } else {
    reporter.log(
      '\x1b[33m[tiles:sync] --no-restart: restart вручную: npm run radar -- stack tiles:up\x1b[0m',
    );
  }

  overall.done();
  reporter.log('\x1b[32mtiles:sync completed\x1b[0m');
  if (!noRestart) {
    reporter.log(`TileServer: ${tileServerUrl()}`);
    reporter.log('Web: VITE_MAP_BASEMAP_STYLE=local в .env → перезапустить web');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
