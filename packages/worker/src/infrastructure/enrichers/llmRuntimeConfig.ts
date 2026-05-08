import { z } from "zod";

const truthy = new Set(["1", "true", "yes", "on"]);

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
});

export type LlmRuntimeConfig = z.infer<typeof llmRuntimeConfigSchema>;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return truthy.has(value.trim().toLowerCase());
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function loadLlmRuntimeConfig(env = process.env): LlmRuntimeConfig {
  const enabled = parseBoolean(env.RADAR_LLM_GEOCODER_ENABLED, false);
  return llmRuntimeConfigSchema.parse({
    enabled,
    provider: env.RADAR_LLM_PROVIDER?.trim() || "ollama",
    baseUrl: env.RADAR_LLM_BASE_URL?.trim() || "http://127.0.0.1:11434/v1",
    model: env.RADAR_LLM_MODEL?.trim() || "qwen2.5:3b",
    timeoutMs: parseNumber(env.RADAR_LLM_TIMEOUT_MS, 60000),
    maxTokens: parseNumber(env.RADAR_LLM_MAX_TOKENS, 220),
    temperature: parseNumber(env.RADAR_LLM_TEMPERATURE, 0),
    jsonMode: parseBoolean(env.RADAR_LLM_JSON_MODE, true),
    retryCount: parseNumber(env.RADAR_LLM_RETRY_COUNT, 0),
  });
}
