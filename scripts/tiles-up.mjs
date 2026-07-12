#!/usr/bin/env node
/**
 * Restart TileServer (артефакты уже в data/tiles/output).
 */
import { createRootCliReporter } from './cli-reporter.mjs';
import { runTileServerEnsure, tileServerUrl } from './tiles/pipeline.mjs';

const reporter = createRootCliReporter();

reporter.log('\x1b[36m=== stack tiles:up ===\x1b[0m');
runTileServerEnsure();
reporter.log(`\x1b[32mTileServer: ${tileServerUrl()}\x1b[0m`);
reporter.log('\x1b[90mПроверка: curl http://127.0.0.1:8081/health\x1b[0m');
