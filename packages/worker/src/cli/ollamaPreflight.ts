import { loadLlmRuntimeConfig } from "../infrastructure/enrichers/llmRuntimeConfig.js";
import { type CliFlagMap, readStringFlag } from "./workerCliArgs.js";

/** Итоговая конфигурация LLM после DEFAULT → manifest → GEO__ → CLI. */
export type OllamaLlmConfig = { baseUrl: string; model: string };

/**
 * CLI overlay для `parse:snap:ollama`: GEO__ поверх манифеста, затем resolved config.
 * Включает enricher `llm` на время CLI (фаза admin не трогается).
 */
export function applyLlmEnv(map: CliFlagMap): OllamaLlmConfig {
  process.env.GEO__llm__enabled = "true";

  const baseUrl = readStringFlag(map, ["base-url"]);
  const model = readStringFlag(map, ["model"]);
  if (baseUrl) process.env.GEO__llm__baseUrl = baseUrl;
  if (model) process.env.GEO__llm__model = model;

  const cfg = loadLlmRuntimeConfig();
  return { baseUrl: cfg.baseUrl, model: cfg.model };
}

/** Проверяет доступность ollama и наличие модели через `/api/tags`. */
async function probeOllama(
  config: OllamaLlmConfig,
): Promise<{ ok: boolean; status?: number; models: string[] }> {
  const url = new URL("/api/tags", config.baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: response.status, models: [] };
    }
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    const models = (body.models ?? []).map((m) => m.name).filter(Boolean) as string[];
    const hasModel =
      models.includes(config.model) ||
      models.some((name) => name.startsWith(`${config.model}:`));
    return { ok: hasModel, status: response.status, models };
  } catch {
    return { ok: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Preflight: бросает ошибку с подсказкой по Windows, если ollama/модель недоступны. */
export async function assertOllamaReady(config: OllamaLlmConfig): Promise<void> {
  const probe = await probeOllama(config);
  if (probe.ok) return;

  const modelsHint =
    probe.models.length > 0
      ? `Доступные модели: ${probe.models.join(", ")}`
      : "Список моделей пуст.";
  throw new Error(
    `Ollama: модель "${config.model}" не найдена на ${config.baseUrl} (status=${probe.status ?? "n/a"}). ${modelsHint}\n` +
      "Частая причина на Windows: локальный ollama.exe на 127.0.0.1:11434 (пустой), а Docker с моделями на другом порту.\n" +
      "Fix: 1) закрой Ollama Desktop, или 2) OLLAMA_PORT=11435 + GEO__llm__baseUrl=http://127.0.0.1:11435/v1 + docker compose --profile llm up -d ollama, или 3) ollama pull в локальный Ollama.",
  );
}
