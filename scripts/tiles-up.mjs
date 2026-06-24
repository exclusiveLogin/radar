#!/usr/bin/env node
/**
 * Только TileServer GL (артефакты уже собраны: tiles:init --build-only).
 */
import { createRootCliReporter } from './cli-reporter.mjs';
import { runTileServerUp, tileServerUrl } from './tiles/pipeline.mjs';

const reporter = createRootCliReporter();

reporter.log('\x1b[36m=== stack tiles:up ===\x1b[0m');
runTileServerUp();
reporter.log(`\x1b[32mTileServer: ${tileServerUrl()}\x1b[0m`);
reporter.log('\x1b[90mПроверка: curl http://127.0.0.1:8081/health\x1b[0m');
