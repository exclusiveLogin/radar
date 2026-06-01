/**
 * Порт LLM-чата (ADR-003, Фаза C). Изолирует пайплайн от конкретного провайдера
 * (локальный Ollama / облачный OpenAI-совместимый, напр. OpenRouter). Энричеры
 * зависят от абстракции, а не от `fetch`.
 */
export type LlmChatRole = "system" | "user" | "assistant";

export type LlmChatMessage = {
  role: LlmChatRole;
  content: string;
};

export type LlmChatOptions = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Запросить `response_format: json_object` у совместимых провайдеров. */
  jsonMode?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type LlmChatResult = {
  /** Извлечённый текст ответа (уже без OpenAI-обёртки). */
  content: string;
  model: string;
  latencyMs: number;
};

export interface ILlmChatClient {
  /** Один запрос к модели. Бросает при HTTP/parse-ошибке (ретраи — выше). */
  chat(messages: LlmChatMessage[], opts: LlmChatOptions): Promise<LlmChatResult>;
  /** Провайдер-специфичный preflight доступности endpoint/модели. */
  preflight(): Promise<void>;
}
