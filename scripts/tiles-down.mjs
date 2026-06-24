#!/usr/bin/env node
/**
 * Остановить TileServer GL (db и dev-стек не трогаем).
 */
import { createRootCliReporter } from './cli-reporter.mjs';
import { runTileServerDown } from './tiles/pipeline.mjs';

const reporter = createRootCliReporter();

reporter.log('\x1b[36m=== stack tiles:down ===\x1b[0m');
runTileServerDown();
reporter.log('\x1b[32mTileServer остановлен\x1b[0m');
