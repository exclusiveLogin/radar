import type { ILocationEnricher, LocationCandidate } from "@radar/shared";
import { z } from "zod";
import { LLM_GEOCODER_SYSTEM_PROMPT } from "./llmGeocoderSystemPrompt.js";
import type { LlmRuntimeConfig } from "./llmRuntimeConfig.js";

const llmResponseSchema = z.object({
  placeName: z.string().min(1).nullable().optional(),
  regionCode: z.string().min(1).nullable().optional(),
  placeFias: z.string().min(1).nullable().optional(),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().max(500).default(""),
});

const openAiCompatResponseSchema = z.object({
  model: z.string().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.union([
            z.string(),
            z.array(
              z.object({
                type: z.string(),
                text: z.string().optional(),
              }),
            ),
          ]),
        }),
      }),
    )
    .min(1),
});

function unwrapJsonPayload(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractContent(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export class LlmEnricher implements ILocationEnricher {
  readonly name = "llm";

  constructor(private readonly config: LlmRuntimeConfig) {}

  async enrich(input: {
    rawText: string;
    regionCode?: string;
  }): Promise<LocationCandidate | null> {
    if (!this.config.enabled) return null;

    const queryNorm = input.rawText.toLowerCase().trim();
    const attempts = Math.max(1, this.config.retryCount + 1);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.config.model,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            ...(this.config.jsonMode ? { response_format: { type: "json_object" } } : {}),
            messages: [
              { role: "system", content: LLM_GEOCODER_SYSTEM_PROMPT },
              {
                role: "user",
                content: JSON.stringify({
                  rawText: input.rawText,
                  regionCodeHint: input.regionCode ?? null,
                }),
              },
            ],
          }),
        });

        if (!response.ok) {
          if (attempt >= attempts) return null;
          continue;
        }

        const payload = openAiCompatResponseSchema.safeParse(await response.json());
        if (!payload.success) {
          if (attempt >= attempts) return null;
          continue;
        }

        const content = extractContent(payload.data.choices[0].message.content);
        const parsedJson = (() => {
          try {
            return JSON.parse(unwrapJsonPayload(content));
          } catch {
            return null;
          }
        })();
        if (!parsedJson) {
          if (attempt >= attempts) return null;
          continue;
        }

        const parsed = llmResponseSchema.safeParse(parsedJson);
        if (!parsed.success) {
          if (attempt >= attempts) return null;
          continue;
        }

        const candidate = parsed.data;
        const hasSignal =
          Boolean(candidate.placeName) ||
          Boolean(candidate.placeFias) ||
          Boolean(candidate.regionCode);

        if (!hasSignal) return null;

        return {
          provider: this.name,
          queryNorm,
          regionCode: input.regionCode ?? candidate.regionCode ?? undefined,
          placeName: candidate.placeName ?? undefined,
          placeFias: candidate.placeFias ?? undefined,
          raw: {
            provider: this.name,
            model: payload.data.model ?? this.config.model,
            confidence: candidate.confidence,
            reason: candidate.reason,
            usage: payload.data.usage ?? null,
            latencyMs: Date.now() - startedAt,
          },
        };
      } catch {
        if (attempt >= attempts) return null;
      } finally {
        clearTimeout(timer);
      }
    }

    return null;
  }
}
