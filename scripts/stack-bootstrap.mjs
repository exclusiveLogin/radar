#!/usr/bin/env node
/**
 * Stack bootstrap — seed phase_definitions из pipeline.manifest.json.phases.
 */
import { loadRepoEnv, repoRoot, run } from './utils.mjs';

loadRepoEnv();
const pass = process.argv.slice(2);
run('npx', ['tsx', 'packages/worker/src/cli/stackBootstrapCli.ts', ...pass], { cwd: repoRoot });
