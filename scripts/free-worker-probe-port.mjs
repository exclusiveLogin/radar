#!/usr/bin/env node
/** Только WORKER_PROBE_PORT (3010) — не трогает api/web при старте worker в concurrently. */
import { loadRepoEnv } from './utils.mjs';
import { freePort } from './free-dev-ports.mjs';

loadRepoEnv();
const port = Number(process.env.WORKER_PROBE_PORT) || 3010;
freePort(port);
