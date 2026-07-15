# ADR-023: Deployment phases bootstrap

## Status

Accepted (2026-07-14).

## Decision

1. deployment.manifest.json.phases — SSOT phase entries
2. manifestSeed.ts — insert-only | apply-config; never overwrite enabled
3. radar stack bootstrap CLI
4. BC: phase manifest:import redirects to stack bootstrap

## Cold start

cold-up → stack bootstrap → data migrate → ingest → parse
