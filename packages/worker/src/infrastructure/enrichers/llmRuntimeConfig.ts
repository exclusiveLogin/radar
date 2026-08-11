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

function resolveManifest(
  manifestOrEnv: GeoEnrichersManifest | NodeJS.ProcessEnv,
): GeoEnrichersManifest {
  if (manifestOrEnv && typeof manifestOrEnv === "object" && "version" in manifestOrEnv) {
    return manifestOrEnv as GeoEnrichersManifest;
  }
  return loadGeoEnrichersManifest({
    repoRoot: MONOREPO_ROOT,
    env: manifestOrEnv as NodeJS.ProcessEnv,
  });
}

function parseLlmSection(
  section: GeoEnrichersManifest["llm"],
  env: NodeJS.ProcessEnv,
): LlmRuntimeConfig {
  return llmRuntimeConfigSchema.parse({
    enabled: section.enabled,
    provider: section.provider,
    baseUrl: section.baseUrl,
    model: section.model,
    timeoutMs: section.timeoutMs,
    maxTokens: section.maxTokens,
    temperature: section.temperature,
    jsonMode: section.jsonMode,
    retryCount: section.retryCount,
    apiKey: env.RADAR_LLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined,
    headers: resolveHeaders(env),
  });
}

/** LLM geocoder runtime из geo.enrichers.manifest.llm (+ секреты из env). */
export function loadLlmRuntimeConfig(
  manifestOrEnv: GeoEnrichersManifest | NodeJS.ProcessEnv = process.env,
  env: NodeJS.ProcessEnv = process.env,
): LlmRuntimeConfig {
  const manifest = resolveManifest(manifestOrEnv);
  return parseLlmSection(manifest.llm, env);
}

/**
 * LLM Validator runtime из geo.enrichers.manifest.llmValidator
 * (fallback на llm, если секция не задана).
 */
export function loadLlmValidatorRuntimeConfig(
  manifestOrEnv: GeoEnrichersManifest | NodeJS.ProcessEnv = process.env,
  env: NodeJS.ProcessEnv = process.env,
): LlmRuntimeConfig {
  const manifest = resolveManifest(manifestOrEnv);
  return parseLlmSection(manifest.llmValidator ?? manifest.llm, env);
}
