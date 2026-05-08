import { z } from "zod";
import { LLM_GEOCODER_SYSTEM_PROMPT } from "./llmGeocoderSystemPrompt.js";
import type { LlmRuntimeConfig } from "./llmRuntimeConfig.js";

// ─── Response schema (multi-place) ────────────────────────────────────────

const llmPlaceSchema = z.object({
  placeName: z.string().min(1),
  kind: z
    .enum(["region", "district", "city", "locality", "settlement"])
    .default("locality"),
  placeFias: z.string().min(1).optional(),
});

const llmResponseSchema = z.object({
  places: z.array(llmPlaceSchema).default([]),
  regionCode: z.string().min(1).nullable().optional(),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().max(500).default(""),
});

export type LlmGeoResponse = z.infer<typeof llmResponseSchema>;
export type LlmGeoPlace = z.infer<typeof llmPlaceSchema>;

// ─── OpenAI-compat response wrapper ───────────────────────────────────────

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
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractContent(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

// ─── Enricher ─────────────────────────────────────────────────────────────

export class LlmEnricher {
  constructor(private readonly config: LlmRuntimeConfig) {}

  async enrich(input: {
    rawText: string;
    regionCode?: string;
  }): Promise<(LlmGeoResponse & { model: string; latencyMs: number }) | null> {
    if (!this.config.enabled) return null;

    const attempts = Math.max(1, this.config.retryCount + 1);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        process.stderr.write(
          `[llm] attempt ${attempt}/${attempts} — ${input.rawText.slice(0, 60).replace(/\n/g, " ")}\n`,
        );

        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.config.model,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            stream: false,
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

        const envelope = openAiCompatResponseSchema.safeParse(await response.json());
        if (!envelope.success) {
          if (attempt >= attempts) return null;
          continue;
        }

        const raw = extractContent(envelope.data.choices[0].message.content);
        let parsedJson: unknown = null;
        try {
          parsedJson = JSON.parse(unwrapJsonPayload(raw));
        } catch {
          if (attempt >= attempts) return null;
          continue;
        }

        const parsed = llmResponseSchema.safeParse(parsedJson);
        if (!parsed.success) {
          if (attempt >= attempts) return null;
          continue;
        }

        const data = parsed.data;
        const hasSignal = data.places.length > 0 || Boolean(data.regionCode);
        if (!hasSignal) {
          process.stderr.write(`[llm] no signal\n`);
          return null;
        }

        const latencyMs = Date.now() - startedAt;
        process.stderr.write(
          `[llm] ok — ${latencyMs}ms places=${data.places.length} confidence=${data.confidence}\n`,
        );
        return {
          ...data,
          model: envelope.data.model ?? this.config.model,
          latencyMs,
        };
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        process.stderr.write(
          `[llm] ${isAbort ? "timeout" : "error"} attempt ${attempt}/${attempts}\n`,
        );
        if (attempt >= attempts) return null;
      } finally {
        clearTimeout(timer);
      }
    }

    return null;
  }
}
