/**
 * Отбор кандидатов для LLM Validator phase (ADR-027).
 * on / off / auto — из YAML; auto = borderline вокруг materialize-порога.
 */
import type { EventCandidate } from "@radar/shared";
import type { GeoScoreMatrix } from "./geoCandidateScore.js";

function readGeoScore(extras: Record<string, unknown>): number | undefined {
  const value = extras.geoScore;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Кандидат в зоне ±margin вокруг materializeGate.threshold. */
export function isBorderlineGeoScore(
  score: number | undefined,
  threshold: number,
  margin: number,
): boolean {
  if (typeof score !== "number") return false;
  // EPS гасит артефакты IEEE-754 на точной границе (0.4 − 0.25).
  return Math.abs(score - threshold) <= margin + 1e-9;
}

/**
 * Фильтрует active geo-кандидатов по trigger-режиму матрицы.
 * off → []; on → все place/region; auto → borderline.
 */
export function selectLlmValidatorCandidates(
  candidates: EventCandidate[],
  matrix: GeoScoreMatrix,
): EventCandidate[] {
  const trigger = matrix.llmValidator.trigger;
  if (trigger === "off") return [];

  const geo = candidates.filter(
    (c) => c.anchor.kind === "place" || c.anchor.kind === "region",
  );

  if (trigger === "on") return geo;

  const { threshold } = matrix.materializeGate;
  const { borderlineMargin } = matrix.llmValidator;
  return geo.filter((c) =>
    isBorderlineGeoScore(readGeoScore(c.extras ?? {}), threshold, borderlineMargin),
  );
}
