/**
 * ---
 * layer: shared/infra
 * domain: infra
 * purpose: Node-only загрузка infra.manifest.json (не для browser bundle).
 * ---
 */
import {
  DEFAULT_INFRA_MANIFEST,
  infraManifestSchema,
  type InfraManifest,
} from "./infraManifest.schema.js";
import { loadDomainManifest } from "../manifest/loadDomainManifest.js";

export type LoadInfraManifestOptions = {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
};

const INFRA_ARRAY_KEYS = { "runners.pipelines": "pipelineKey" };

/** Загружает infra manifest (INFRA__ env overlay). */
export function loadInfraManifest(options: LoadInfraManifestOptions): InfraManifest {
  return loadDomainManifest<InfraManifest>({
    repoRoot: options.repoRoot,
    env: options.env,
    fileBase: "infra",
    envPrefix: "INFRA",
    schema: infraManifestSchema,
    defaults: DEFAULT_INFRA_MANIFEST,
    arrayKeys: INFRA_ARRAY_KEYS,
    legacyLocalFiles: ["infra.local.json", "deployment.local.json"],
  });
}
