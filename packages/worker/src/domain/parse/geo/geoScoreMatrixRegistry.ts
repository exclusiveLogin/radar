import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { GeoScoreFactorWeights, GeoScoreMatrix } from "./geoCandidateScore.js";

function defaultMatrix(): GeoScoreMatrix {
  return {
    revision: "builtin",
    base: 1.0,
    majorityClusterMin: 3,
    materializeGate: { enabled: true, threshold: 0.25 },
    factors: {
      uniqueStem: 0.15,
      imprecise: -0.2,
      adjectiveStem: -0.45,
      minorityRegion: -0.5,
      geoConflict: -0.35,
      channelPromo: -0.7,
      llmConfidence: 0.25,
    },
  };
}

function readNumber(raw: string, key: string, fallback: number): number {
  const re = new RegExp(`^\\s*${key}:\\s*(-?[0-9.]+)`, "m");
  const match = raw.match(re);
  if (!match?.[1]) return fallback;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : fallback;
}

function readBool(raw: string, key: string, fallback: boolean): boolean {
  const re = new RegExp(`^\\s*${key}:\\s*(true|false)`, "m");
  const match = raw.match(re);
  if (!match?.[1]) return fallback;
  return match[1] === "true";
}

function readFactorWeight(raw: string, name: string, fallback: number): number {
  const block = raw.match(new RegExp(`${name}:\\s*\\n((?:\\s{4}.+\\n)*)`));
  if (!block?.[1]) return fallback;
  const weightMatch = block[1].match(/weight:\s*(-?[0-9.]+)/);
  if (!weightMatch?.[1]) return fallback;
  const n = Number(weightMatch[1]);
  return Number.isFinite(n) ? n : fallback;
}

/** Hand-rolled YAML parser для geo-score.v1.yaml. */
export function parseGeoScoreMatrixYaml(raw: string): GeoScoreMatrix {
  const defaults = defaultMatrix();
  const revisionMatch = raw.match(/^revision:\s*"?([^"\n]+)"?/m);
  const revision = revisionMatch?.[1]?.trim() ?? defaults.revision;

  const factors: GeoScoreFactorWeights = {
    uniqueStem: readFactorWeight(raw, "uniqueStem", defaults.factors.uniqueStem),
    imprecise: readFactorWeight(raw, "imprecise", defaults.factors.imprecise),
    adjectiveStem: readFactorWeight(raw, "adjectiveStem", defaults.factors.adjectiveStem),
    minorityRegion: readFactorWeight(raw, "minorityRegion", defaults.factors.minorityRegion),
    geoConflict: readFactorWeight(raw, "geoConflict", defaults.factors.geoConflict),
    channelPromo: readFactorWeight(raw, "channelPromo", defaults.factors.channelPromo),
    llmConfidence: readFactorWeight(raw, "llmConfidence", defaults.factors.llmConfidence),
  };

  return {
    revision,
    base: readNumber(raw, "base", defaults.base),
    majorityClusterMin: readNumber(raw, "majorityClusterMin", defaults.majorityClusterMin),
    materializeGate: {
      enabled: readBool(raw, "enabled", defaults.materializeGate.enabled),
      threshold: readNumber(raw, "threshold", defaults.materializeGate.threshold),
    },
    factors,
  };
}

let cached: GeoScoreMatrix | null = null;

export function loadGeoScoreMatrix(): GeoScoreMatrix {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../../../../data/parse/geo-score.v1.yaml");
  try {
    cached = parseGeoScoreMatrixYaml(readFileSync(path, "utf8"));
  } catch {
    cached = defaultMatrix();
  }
  return cached;
}

/** Сброс кэша (тесты). */
export function resetGeoScoreMatrixCache(): void {
  cached = null;
}

export function geoScoreMatrixRevisionHash(matrix: GeoScoreMatrix): string {
  return createHash("sha256").update(JSON.stringify(matrix), "utf8").digest("hex").slice(0, 12);
}
