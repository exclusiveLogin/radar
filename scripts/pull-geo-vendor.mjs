#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadGeoConfig, repoRoot, run } from './utils.mjs';

const vendor = join(repoRoot, 'data', 'geo', 'vendor');
const config = loadGeoConfig();

for (const s of config.sources) {
  const dir = join(vendor, s.vendorDir);
  if (!existsSync(join(dir, '.git'))) {
    console.log(`[skip] нет ${s.vendorDir}`);
    continue;
  }
  console.log(`git pull ${s.vendorDir} ...`);
  run('git', ['pull', '--ff-only'], { cwd: dir });
}
