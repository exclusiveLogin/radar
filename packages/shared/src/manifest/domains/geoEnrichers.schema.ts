import { z } from "zod";

export const geoEnrichersDadataSchema = z.object({
  enabled: z.boolean().default(true),
});

export const geoEnrichersNominatimSchema = z.object({
  enabled: z.boolean().default(true),
  minIntervalMs: z.number().int().positive().default(1100),
  backoffMs: z.number().int().positive().default(15_000),
  maxBackoffMs: z.number().int().positive().default(120_000),
  maxRetries: z.number().int().min(0).max(10).default(4),
  userAgent: z.string().optional(),
});

export const geoEnrichersLlmSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(["ollama", "openai-compatible"]).default("ollama"),
  baseUrl: z.string().default("http://127.0.0.1:11434/v1"),
  model: z.string().default("qwen2.5:3b"),
  timeoutMs: z.number().int().positive().max(300_000).default(5000),
  maxTokens: z.number().int().positive().max(2048).default(220),
  temperature: z.number().min(0).max(1).default(0),
  jsonMode: z.boolean().default(true),
  retryCount: z.number().int().min(0).max(3).default(1),
});

export const geoEnrichersPipelineSchema = z.object({
  order: z.array(z.enum(["catalog", "llm", "dadata", "nominatim"])).optional(),
});

export const geoEnrichersManifestSchema = z.object({
  version: z.literal(1).default(1),
  dadata: geoEnrichersDadataSchema.default({}),
  nominatim: geoEnrichersNominatimSchema.default({}),
  llm: geoEnrichersLlmSchema.default({}),
  /** Отдельная модель/endpoint для валидатора (clone llm defaults). */
  llmValidator: geoEnrichersLlmSchema.optional(),
  pipeline: geoEnrichersPipelineSchema.default({}),
});

export type GeoEnrichersManifest = z.infer<typeof geoEnrichersManifestSchema>;

export const DEFAULT_GEO_ENRICHERS_MANIFEST: GeoEnrichersManifest =
  geoEnrichersManifestSchema.parse({ version: 1 });
