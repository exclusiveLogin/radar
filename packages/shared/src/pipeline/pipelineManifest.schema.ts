/**
 * ---
 * layer: shared/pipeline
 * domain: pipeline
 * purpose: SSOT pipeline.manifest.json — шаги и фазы (что течёт).
 *          Env overlay — PIPELINE__* через loadDomainManifest.
 * ---
 */
import { z } from "zod";
import { ingestModeSchema } from "../schemas/ingest/ingest-domain.js";
import { phaseManifestEntrySchema, phaseScopeSchema } from "../schemas/enrichment/phase.js";
import { radarRoutingKeySchema } from "../transport/radarRoutingKey.js";

export { radarRoutingKeySchema };

export const stepTriggerAcceptsSchema = z.object({
  lane: z.array(ingestModeSchema).optional(),
});

export const stepTriggerSchema = z.object({
  on: z.array(radarRoutingKeySchema).default([]),
  accepts: stepTriggerAcceptsSchema.default({}),
  debounceMs: z.number().int().nonnegative().default(250),
});

export const stepResetsSchema = z.object({
  handler: z.string().min(1),
  cascade: z.boolean().default(true),
});

export const stepDescriptorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["source", "queue"]),
  pipelineKey: z.string().min(1),
  label: z.string().optional(),
  trigger: stepTriggerSchema.default({ on: [], accepts: {}, debounceMs: 250 }),
  phases: z.object({ scope: phaseScopeSchema }).optional(),
  emits: z.array(radarRoutingKeySchema).default([]),
  resets: stepResetsSchema.optional(),
  enabled: z.boolean().default(true),
});
export type StepDescriptor = z.infer<typeof stepDescriptorSchema>;

export const pipelineManifestSchema = z.object({
  version: z.literal(1).default(1),
  steps: z.array(stepDescriptorSchema).default([]),
  phases: z.array(phaseManifestEntrySchema).default([]),
});
export type PipelineManifest = z.infer<typeof pipelineManifestSchema>;

export const DEFAULT_PIPELINE_MANIFEST: PipelineManifest = pipelineManifestSchema.parse({
  version: 1,
  steps: [],
  phases: [],
});
