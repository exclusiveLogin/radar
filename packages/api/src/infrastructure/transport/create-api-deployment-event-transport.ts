/**
 * ---
 * layer: api/infrastructure/transport
 * domain: realtime
 * purpose: API-owned RMQ factory from infra manifest.
 * ---
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DataSource } from "typeorm";
import type { InfraManifest, IEventTransport } from "@radar/shared";
import { MONOREPO_ROOT } from "../../monorepo-root.js";
import { createApiEventTransport } from "./createEventTransport.js";

/** Создаёт API transport; routing keys остаются SSOT shared topic catalog. */
export function createApiDeploymentEventTransport(dataSource: DataSource): IEventTransport {
  const nodeRequire = createRequire(__filename);
  const loaderPath = join(MONOREPO_ROOT, "packages/shared/dist/infra/infraManifest.loader.js");
  const { loadInfraManifest } = nodeRequire(loaderPath) as {
    loadInfraManifest: (opts: { repoRoot: string }) => InfraManifest;
  };
  return createApiEventTransport(
    loadInfraManifest({ repoRoot: MONOREPO_ROOT }).transport,
    dataSource,
  );
}
