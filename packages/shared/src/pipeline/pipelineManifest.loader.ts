/**
 * ---
 * layer: shared/pipeline
 * domain: pipeline
 * purpose: Node-only загрузка pipeline.manifest.json (не для browser bundle).
 * ---
 */
import {
  DEFAULT_PIPELINE_MANIFEST,
  pipelineManifestSchema,
  type PipelineManifest,
} from "./pipelineManifest.schema.js";
import { loadDomainManifest } from "../manifest/loadDomainManifest.js";

export type LoadPipelineManifestOptions = {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
};

const PIPELINE_ARRAY_KEYS = {
  steps: "id",
  phases: "id",
};

/** Загружает pipeline manifest (PIPELINE__ env overlay). */
export function loadPipelineManifest(
  options: LoadPipelineManifestOptions,
): PipelineManifest {
  return loadDomainManifest<PipelineManifest>({
    repoRoot: options.repoRoot,
    env: options.env,
    fileBase: "pipeline",
    envPrefix: "PIPELINE",
    schema: pipelineManifestSchema,
    defaults: DEFAULT_PIPELINE_MANIFEST,
    arrayKeys: PIPELINE_ARRAY_KEYS,
    legacyLocalFiles: ["pipeline.local.json"],
  });
}
