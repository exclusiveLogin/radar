#!/usr/bin/env node
/**
 * Подготовка basemap-артефактов без TileServer:
 * download → merge → build → verify.
 *
 * Потом отдельно: stack dev --full + stack tiles:up
 */
import { createRootCliReporter, parseCliFlags } from './cli-reporter.mjs';
import { runTilesBuildPipeline, tileServerUrl } from './tiles/pipeline.mjs';

const { verbose } = parseCliFlags();
const reporter = createRootCliReporter({ verbose });

reporter.log('\x1b[36m=== stack tiles:prepare ===\x1b[0m');
reporter.log(
  '\x1b[90mТолько артефакты в data/tiles/. Сервер: npm run radar -- stack tiles:up\x1b[0m',
);
reporter.log(
  '\x1b[90mDev: npm run radar -- stack dev --full (параллельно с tiles:up)\x1b[0m',
);

const overall = reporter.startStage('tiles:prepare', 1);
runTilesBuildPipeline({ verbose, reporter });
overall.tick();
overall.done();

reporter.log('\x1b[32mtiles:prepare completed\x1b[0m');
reporter.log(`Дальше: stack tiles:up  →  ${tileServerUrl()}`);
reporter.log('Web: VITE_MAP_BASEMAP_STYLE=local в .env');
