#!/usr/bin/env node
/**
 * Первичный init: build-артефакты + TileServer GL (profile tiles).
 * Для параллельного dev: после init в .env → VITE_MAP_BASEMAP_STYLE=local.
 */
import { createRootCliReporter, parseCliFlags } from './cli-reporter.mjs';
import {
  runTileServerUp,
  runTilesBuildPipeline,
  tileServerUrl,
} from './tiles/pipeline.mjs';

const { verbose } = parseCliFlags();
const reporter = createRootCliReporter({ verbose });
const buildOnly = process.argv.includes('--build-only') || process.argv.includes('--no-up');

async function main() {
  reporter.log('\x1b[36m=== stack tiles:init ===\x1b[0m');
  reporter.log(
    '\x1b[90mПараллельно с dev: терминал 1 → stack dev --full | терминал 2 → stack tiles:up\x1b[0m',
  );

  const overall = reporter.startStage('tiles:init', buildOnly ? 1 : 2);
  runTilesBuildPipeline({ verbose, reporter });
  overall.tick();

  if (!buildOnly) {
    reporter.log('\n\x1b[36m[tiles:init] TileServer GL up\x1b[0m');
    runTileServerUp();
    overall.tick();
  } else {
    reporter.log('\x1b[33m[tiles:init] --build-only: TileServer не поднимаем (stack tiles:up)\x1b[0m');
  }

  overall.done();
  reporter.log('\x1b[32mtiles:init completed\x1b[0m');
  if (!buildOnly) {
    reporter.log(`TileServer: ${tileServerUrl()}`);
    reporter.log('Web: VITE_MAP_BASEMAP_STYLE=local в .env → перезапустить web');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
