/**
 * LLM Validator: аудит существующих geo-кандидатов по id (не re-geocoding).
 */
import { z } from "zod";
import type { ILlmChatClient } from "@radar/shared";
import { createLlmChatClient } from "./llmChatClient.js";
import type { LlmRuntimeConfig } from "./llmRuntimeConfig.js";
import { LLM_VALIDATOR_SYSTEM_PROMPT } from "./llmValidatorSystemPrompt.js";
import { normalizeLlmConfidence } from "./normalizeLlmConfidence.js";

const verdictSchema = z.object({
  candidateId: z.string().min(1),
  verdict: z.enum(["confirm", "reject"]),
  confidence: z.preprocess(normalizeLlmConfidence, z.number().min(0).max(1)),
  reason: z.string().max(400).nullable().catch(null).optional(),
});

const responseSchema = z.object({
  verdicts: z.array(verdictSchema).default([]),
});

export type LlmValidatorCandidateInput = {
  id: string;
  name: string;
  kind: string;
  regionCode?: string;
  geoScore?: number;
  flags: {
    matchedViaAdjectiveStem?: boolean;
    geoImprecise?: boolean;
    minorityRegion?: boolean;
    geoConflict?: boolean;
    uniqueStem?: boolean;
  };
};

export type LlmValidatorResponse = {
  verdicts: Array<{
    candidateId: string;
    verdict: "confirm" | "reject";
    confidence: number;
    reason?: string;
  }>;
  model: string;
  latencyMs: number;
};

function unwrapJsonPayload(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export class LlmValidatorEnricher {
  private readonly client: ILlmChatClient;

  constructor(
    private readonly config: LlmRuntimeConfig,
    client?: ILlmChatClient,
  ) {
    this.client = client ?? createLlmChatClient(config);
  }

  async validate(input: {
    rawText: string;
    candidates: LlmValidatorCandidateInput[];
  }): Promise<LlmValidatorResponse | null> {
    if (!this.config.enabled) return null;
    if (input.candidates.length === 0) return null;

    const allowedIds = new Set(input.candidates.map((c) => c.id));
    const userPayload = JSON.stringify({
      rawText: input.rawText,
      candidates: input.candidates,
    });

    const attempts = Math.max(1, this.config.retryCount + 1);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        process.stderr.write(
          `[llm-validator] attempt ${attempt}/${attempts} candidates=${input.candidates.length}\n`,
        );

        const result = await this.client.chat(
          [
            { role: "system", content: LLM_VALIDATOR_SYSTEM_PROMPT },
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

        let parsedJson: unknown = null;
        try {
          parsedJson = JSON.parse(unwrapJsonPayload(result.content));
        } catch (parseErr) {
          process.stderr.write(`[llm-validator] JSON parse failed: ${String(parseErr)}\n`);
          if (attempt >= attempts) return null;
          continue;
        }

        const parsed = responseSchema.safeParse(parsedJson);
        if (!parsed.success) {
          process.stderr.write(
            `[llm-validator] schema failed: ${JSON.stringify(parsed.error.issues)}\n`,
          );
          if (attempt >= attempts) return null;
          continue;
        }

        const verdicts = parsed.data.verdicts
          .filter((v) => allowedIds.has(v.candidateId))
          .map((v) => ({
            candidateId: v.candidateId,
            verdict: v.verdict,
            confidence: v.confidence,
            ...(v.reason ? { reason: v.reason } : {}),
          }));

        process.stderr.write(
          `[llm-validator] ok — ${result.latencyMs}ms verdicts=${verdicts.length}\n`,
        );
        return { verdicts, model: result.model, latencyMs: result.latencyMs };
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        process.stderr.write(
          `[llm-validator] ${isAbort ? "timeout" : "error"} attempt ${attempt}/${attempts}: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
        if (attempt >= attempts) return null;
      } finally {
        clearTimeout(timer);
      }
    }

    return null;
  }
}
