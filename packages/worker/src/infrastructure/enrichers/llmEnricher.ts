import { z } from "zod";
import type { ILlmChatClient } from "@radar/shared";
import { LLM_GEOCODER_SYSTEM_PROMPT } from "./llmGeocoderSystemPrompt.js";
import { createLlmChatClient } from "./llmChatClient.js";
import type { LlmRuntimeConfig } from "./llmRuntimeConfig.js";
import { normalizeLlmConfidence } from "./normalizeLlmConfidence.js";

// ─── Response schema (multi-place) ────────────────────────────────────────

const llmPlaceSchema = z.object({
  placeName: z.string().min(1),
  kind: z
    .enum(["region", "district", "city", "locality", "settlement"])
    .default("locality"),
  regionCode: z.string().min(1).nullable().catch(null).optional(),
  placeFias: z.string().min(1).nullable().catch(null).optional(),
  /** Уверенность LLM в этой привязке (0..1). */
  confidence: z
    .preprocess(normalizeLlmConfidence, z.number().min(0).max(1))
    .optional(),
  /** Краткое обоснование именно этой привязки. */
  reason: z.string().max(200).nullable().catch(null).optional(),
});

const llmResponseSchema = z.object({
  places: z.array(llmPlaceSchema).default([]),
  regionCode: z.string().min(1).nullable().catch(null).optional(),
  confidence: z.preprocess(normalizeLlmConfidence, z.number().min(0).max(1)),
  reason: z.string().max(400).nullable().catch("").transform((v) => v ?? ""),
  /** Семантическая группа события (сигнал, не подменяет классификатор). */
  eventCategory: z
    .enum(["threat", "impact", "all_clear", "movement", "other"])
    .nullable()
    .catch(null)
    .optional(),
});

export type LlmGeoResponse = z.infer<typeof llmResponseSchema>;
export type LlmGeoPlace = z.infer<typeof llmPlaceSchema>;

function unwrapJsonPayload(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

// ─── Enricher ─────────────────────────────────────────────────────────────

export class LlmEnricher {
  private readonly client: ILlmChatClient;

  constructor(
    private readonly config: LlmRuntimeConfig,
    client?: ILlmChatClient,
  ) {
    this.client = client ?? createLlmChatClient(config);
  }
async enrich(input: {
    rawText: string;
    regionCode?: string;
    catalogRegions?: Array<{ code: string; name: string }>;
    localityAnchors?: Array<{
      name: string;
      regionCode: string;
      kind: "city" | "locality" | "settlement";
    }>;
  }): Promise<(LlmGeoResponse & { model: string; latencyMs: number }) | null> {
    if (!this.config.enabled) return null;

    const attempts = Math.max(1, this.config.retryCount + 1);

    const userPayload = JSON.stringify({
      rawText: input.rawText,
      regionCodeHint: input.regionCode ?? null,
      catalogRegions: input.catalogRegions ?? null,
      localityAnchors:
        input.localityAnchors && input.localityAnchors.length > 0
          ? input.localityAnchors
          : null,
    });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        process.stderr.write(
          `[llm] attempt ${attempt}/${attempts} — ${input.rawText.slice(0, 120).replace(/\n/g, " ")}\n model: ${this.config.model}`,
        );

        const result = await this.client.chat(
          [
            { role: "system", content: LLM_GEOCODER_SYSTEM_PROMPT },
            { role: "user", content: userPayload },
          ],
          {
            model: this.config.model,
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            jsonMode: this.config.jsonMode,
            signal: controller.signal,
          },
        );

        process.stderr.write(`[llm] raw response: ${result.content.slice(0, 300)}\n`);

        let parsedJson: unknown = null;
        try {
          parsedJson = JSON.parse(unwrapJsonPayload(result.content));
        } catch (parseErr) {
          process.stderr.write(`[llm] JSON parse failed: ${String(parseErr)}\n`);
          if (attempt >= attempts) return null;
          continue;
        }

        const parsed = llmResponseSchema.safeParse(parsedJson);
        if (!parsed.success) {
          process.stderr.write(`[llm] schema validation failed: ${JSON.stringify(parsed.error.issues)}\n`);
          if (attempt >= attempts) return null;
          continue;
        }

        const data = parsed.data;
        const hasSignal = data.places.length > 0 || Boolean(data.regionCode);
        if (!hasSignal) {
          process.stderr.write(`[llm] no signal\n`);
          return null;
        }

        process.stderr.write(
          `[llm] ok — ${result.latencyMs}ms places=${data.places.length} confidence=${data.confidence}\n`,
        );
        return { ...data, model: result.model, latencyMs: result.latencyMs };
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        process.stderr.write(
          `[llm] ${isAbort ? "timeout" : "error"} attempt ${attempt}/${attempts}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        if (attempt >= attempts) return null;
      } finally {
        clearTimeout(timer);
      }
    }

    return null;
  }
}
