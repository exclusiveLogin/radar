import { z } from "zod";
import type { GeoEnrichersManifest } from "@radar/shared/manifest/domains/geoEnrichers.loader.js";
import { loadGeoEnrichersManifest } from "@radar/shared/manifest/domains/geoEnrichers.loader.js";
import { MONOREPO_ROOT } from "@repo/root";

const llmRuntimeConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["ollama", "openai-compatible"]),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  timeoutMs: z.number().int().positive().max(300000),
  maxTokens: z.number().int().positive().max(2048),
  temperature: z.number().min(0).max(1),
  jsonMode: z.boolean(),
  retryCount: z.number().int().min(0).max(3),
  /** Bearer-токен для облачных провайдеров (OpenRouter и т.п.). */
  apiKey: z.string().min(1).optional(),
  /** Доп. заголовки (напр. HTTP-Referer/X-Title для OpenRouter). */
  headers: z.record(z.string()).default({}),
});

export type LlmRuntimeConfig = z.infer<typeof llmRuntimeConfigSchema>;

/** Собирает доп. заголовки провайдера из env (без пустых значений). */
function resolveHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = {};
  const referer = env.RADAR_LLM_HTTP_REFERER?.trim();
  const title = env.RADAR_LLM_X_TITLE?.trim();
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;
  return headers;
}

/** LLM runtime из geo.enrichers.manifest (+ секреты из env). */
export function loadLlmRuntimeConfig(
  manifestOrEnv: GeoEnrichersManifest | NodeJS.ProcessEnv = process.env,
  env: NodeJS.ProcessEnv = process.env,
): LlmRuntimeConfig {
  const manifest =
    manifestOrEnv && typeof manifestOrEnv === "object" && "version" in manifestOrEnv
      ? (manifestOrEnv as GeoEnrichersManifest)
      : loadGeoEnrichersManifest({ repoRoot: MONOREPO_ROOT, env: manifestOrEnv as NodeJS.ProcessEnv });
  const llm = manifest.llm;
  return llmRuntimeConfigSchema.parse({
    enabled: llm.enabled,
    provider: llm.provider,
    baseUrl: llm.baseUrl,
    model: llm.model,
    timeoutMs: llm.timeoutMs,
    maxTokens: llm.maxTokens,
    temperature: llm.temperature,
    jsonMode: llm.jsonMode,
    retryCount: llm.retryCount,
    apiKey: env.RADAR_LLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined,
    headers: resolveHeaders(env),
  });
}
