import {
  DEFAULT_TRACKING_PIPELINE_MANIFEST,
  trackingPipelineManifestSchema,
  type TrackingPipelineManifest,
} from "./trackingPipeline.schema.js";
import { loadDomainManifest } from "../loadDomainManifest.js";

export type LoadTrackingPipelineManifestOptions = {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
};

/** Загружает tracking.pipeline.manifest.json + TRACKING__ env overlay. */
export function loadTrackingPipelineManifest(
  options: LoadTrackingPipelineManifestOptions,
): TrackingPipelineManifest {
  return loadDomainManifest<TrackingPipelineManifest>({
    repoRoot: options.repoRoot,
    env: options.env,
    fileBase: "tracking.pipeline",
    envPrefix: "TRACKING",
    schema: trackingPipelineManifestSchema,
    defaults: DEFAULT_TRACKING_PIPELINE_MANIFEST,
  });
}

export {
  DEFAULT_TRACKING_PIPELINE_MANIFEST,
  type TrackingPipelineManifest,
} from "./trackingPipeline.schema.js";
