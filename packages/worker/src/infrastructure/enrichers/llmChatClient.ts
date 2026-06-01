/**
 * Реализации порта `ILlmChatClient` (ADR-003, Фаза C).
 *
 * Оба клиента бьют в OpenAI-совместимый `${baseUrl}/chat/completions` и
 * различаются только аутентификацией/заголовками и preflight:
 * - Ollama: без авторизации, preflight через `/api/tags`;
 * - OpenAI-compatible (OpenRouter): `Authorization: Bearer`, доп. заголовки
 *   `HTTP-Referer`/`X-Title`, preflight через `/models`.
 */
import { z } from "zod";
import type {
  ILlmChatClient,
  LlmChatMessage,
  LlmChatOptions,
  LlmChatResult,
} from "@radar/shared";
import type { LlmRuntimeConfig } from "./llmRuntimeConfig.js";

const openAiCompatResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.union([
            z.string(),
            z.array(z.object({ type: z.string(), text: z.string().optional() })),
          ]),
        }),
      }),
    )
    .min(1),
});

function extractContent(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") return content;
  return content.map((part) => part.text ?? "").join("").trim();
}

/** Общая реализация OpenAI-совместимого chat-эндпоинта поверх конфигурации. */
abstract class OpenAiCompatBaseClient implements ILlmChatClient {
  constructor(protected readonly config: LlmRuntimeConfig) {}

  protected abstract buildHeaders(): Record<string, string>;

  abstract preflight(): Promise<void>;

  async chat(messages: LlmChatMessage[], opts: LlmChatOptions): Promise<LlmChatResult> {
    const startedAt = Date.now();
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature ?? this.config.temperature,
        max_tokens: opts.maxTokens ?? this.config.maxTokens,
        stream: false,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`LLM HTTP ${response.status}${errBody ? `: ${errBody.slice(0, 300)}` : ""}`);
    }

    const envelope = openAiCompatResponseSchema.safeParse(await response.json());
    if (!envelope.success) {
      throw new Error("LLM: неожиданный формат ответа chat/completions");
    }

    return {
      content: extractContent(envelope.data.choices[0].message.content),
      model: envelope.data.model ?? opts.model,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** Локальный Ollama: без авторизации, preflight по `/api/tags`. */
export class OllamaChatClient extends OpenAiCompatBaseClient {
  protected buildHeaders(): Record<string, string> {
    return { "Content-Type": "application/json", ...this.config.headers };
  }

  async preflight(): Promise<void> {
    const url = new URL("/api/tags", this.config.baseUrl).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { method: "GET", signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Ollama недоступен на ${this.config.baseUrl} (status=${response.status})`);
      }
      const body = (await response.json()) as { models?: Array<{ name?: string }> };
      const models = (body.models ?? []).map((m) => m.name).filter(Boolean) as string[];
      const hasModel =
        models.includes(this.config.model) ||
        models.some((name) => name.startsWith(`${this.config.model}:`));
      if (!hasModel) {
        throw new Error(
          `Ollama: модель "${this.config.model}" не найдена на ${this.config.baseUrl}. Доступно: ${models.join(", ") || "пусто"}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Облачный OpenAI-совместимый провайдер (OpenRouter): Bearer + доп. заголовки. */
export class OpenAiCompatibleChatClient extends OpenAiCompatBaseClient {
  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  async preflight(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error("LLM provider=openai-compatible требует RADAR_LLM_API_KEY");
    }
  }
}

/** Выбор клиента по провайдеру из конфигурации (DIP-фабрика). */
export function createLlmChatClient(config: LlmRuntimeConfig): ILlmChatClient {
  return config.provider === "openai-compatible"
    ? new OpenAiCompatibleChatClient(config)
    : new OllamaChatClient(config);
}
