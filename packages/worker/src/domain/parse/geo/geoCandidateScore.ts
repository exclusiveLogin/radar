/**
 * Чистая формула geo-score кандидата (ADR-027).
 * Веса и порог — только из GeoScoreMatrix (YAML SSOT).
 */

export type GeoScoreFactorWeights = {
  uniqueStem: number;
  imprecise: number;
  adjectiveStem: number;
  minorityRegion: number;
  geoConflict: number;
  channelPromo: number;
  /** Scaled: weight * (llmConfidence - 0.5) * 2 */
  llmConfidence: number;
  /** Signed: confirm → +weight*c, reject → −weight*c */
  llmValidatorConfidence: number;
};

export type LlmValidatorTriggerMode = "on" | "off" | "auto";

export type GeoScoreMatrix = {
  revision: string;
  base: number;
  majorityClusterMin: number;
  materializeGate: {
    enabled: boolean;
    threshold: number;
  };
  factors: GeoScoreFactorWeights;
  llmValidator: {
    trigger: LlmValidatorTriggerMode;
    borderlineMargin: number;
  };
};

/** Булевы / опциональные сигналы одного кандидата. */
export type GeoScoreFactors = {
  uniqueStem: boolean;
  geoImprecise: boolean;
  matchedViaAdjectiveStem: boolean;
  minorityRegion: boolean;
  geoConflict: boolean;
  channelPromo: boolean;
  /** 0..1 от LLM enrich; отсутствует → фактор не применяется. */
  llmConfidence?: number;
  /** Вердикт LLM Validator (ID-based). */
  llmValidatorVerdict?: "confirm" | "reject";
  /** 0..1 уверенность валидатора; отсутствует → фактор не применяется. */
  llmValidatorConfidence?: number;
};

export type GeoScoreResult = {
  score: number;
  breakdown: Record<string, number>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Вклад scaled llmConfidence: [-weight .. +weight]. */
export function scaledLlmConfidenceContribution(
  llmConfidence: number | undefined,
  weight: number,
): number {
  if (typeof llmConfidence !== "number" || Number.isNaN(llmConfidence)) {
    return 0;
  }
  const c = clamp(llmConfidence, 0, 1);
  return weight * (c - 0.5) * 2;
}

/**
 * Вклад LLM Validator: знак задаёт verdict, амплитуду — confidence.
 * confirm → +weight*c, reject → −weight*c.
 */
export function signedLlmValidatorContribution(
  verdict: "confirm" | "reject" | undefined,
  confidence: number | undefined,
  weight: number,
): number {
  if (!verdict) return 0;
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return 0;
  const c = clamp(confidence, 0, 1);
  return verdict === "confirm" ? weight * c : -weight * c;
}

/**
 * score = clamp(base + Σ contributions, 0, 2).
 * Boolean-фактор: when → weight, иначе 0.
 */
export function computeGeoCandidateScore(
  factors: GeoScoreFactors,
  matrix: GeoScoreMatrix,
): GeoScoreResult {
  const breakdown: Record<string, number> = {};
  const w = matrix.factors;

  if (factors.uniqueStem) breakdown.uniqueStem = w.uniqueStem;
  if (factors.geoImprecise) breakdown.imprecise = w.imprecise;
  if (factors.matchedViaAdjectiveStem) breakdown.adjectiveStem = w.adjectiveStem;
  if (factors.minorityRegion) breakdown.minorityRegion = w.minorityRegion;
  if (factors.geoConflict) breakdown.geoConflict = w.geoConflict;
  if (factors.channelPromo) breakdown.channelPromo = w.channelPromo;

  const llmPart = scaledLlmConfidenceContribution(factors.llmConfidence, w.llmConfidence);
  if (llmPart !== 0) breakdown.llmConfidence = llmPart;

  const validatorPart = signedLlmValidatorContribution(
    factors.llmValidatorVerdict,
    factors.llmValidatorConfidence,
    w.llmValidatorConfidence,
  );
  if (validatorPart !== 0) breakdown.llmValidatorConfidence = validatorPart;

  let sum = matrix.base;
  for (const value of Object.values(breakdown)) {
    sum += value;
  }

  return {
    score: Math.round(clamp(sum, 0, 2) * 1e6) / 1e6,
    breakdown,
  };
}
