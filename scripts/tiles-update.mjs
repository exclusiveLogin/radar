#!/usr/bin/env node
/**
 * Обновление basemap: пересборка артефактов (skip существующих) + перезапуск TileServer.
 */
import { createRootCliReporter, parseCliFlags } from './cli-reporter.mjs';
import {
  runTileServerUp,
  runTilesBuildPipeline,
  tileServerUrl,
} from './tiles/pipeline.mjs';

const { verbose } = parseCliFlags();
const reporter = createRootCliReporter({ verbose });
const noUp = process.argv.includes('--no-up');

async function main() {
  reporter.log('\x1b[36m=== stack tiles:update ===\x1b[0m');

  const overall = reporter.startStage('tiles:update', noUp ? 1 : 2);
  runTilesBuildPipeline({ verbose, reporter });
  overall.tick();

  if (!noUp) {
    reporter.log('\n\x1b[36m[tiles:update] перезапуск TileServer GL\x1b[0m');
    runTileServerUp();
    overall.tick();
  }

  overall.done();
  reporter.log('\x1b[32mtiles:update completed\x1b[0m');
  if (!noUp) reporter.log(`TileServer: ${tileServerUrl()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
