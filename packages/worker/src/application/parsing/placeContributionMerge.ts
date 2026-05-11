import { isDeepStrictEqual } from "node:util";
import type { PlaceContribution, PlaceRecord } from "@radar/shared";

const TRUST_STATE_RANK: Record<NonNullable<PlaceRecord["trustState"]>, number> = {
  rejected: 0,
  unverified: 1,
  partially_verified: 2,
  verified: 3,
};

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function tryApplyField<T>(params: {
  incoming: T | null | undefined;
  existing: T | null | undefined;
  incomingNotWorse: boolean;
  apply: (value: T) => void;
}): boolean {
  const { incoming, existing, incomingNotWorse, apply } = params;
  if (incoming === undefined || incoming === null) return false;
  if (!incomingNotWorse && hasValue(existing)) return false;
  if (isDeepStrictEqual(existing, incoming)) return false;
  apply(incoming);
  return true;
}

function mergeEvidenceProviders(
  current: PlaceRecord["evidenceProviders"],
  provider: PlaceContribution["provider"],
): PlaceRecord["evidenceProviders"] {
  return [...new Set([...(current ?? []), provider])];
}

export function monotonicTrustState(
  current: PlaceRecord["trustState"],
  incoming: NonNullable<PlaceRecord["trustState"]>,
): NonNullable<PlaceRecord["trustState"]> {
  if (!current) return incoming;
  return TRUST_STATE_RANK[incoming] >= TRUST_STATE_RANK[current] ? incoming : current;
}

export function mergePlaceContribution(
  current: PlaceRecord,
  contribution: PlaceContribution,
): { next: PlaceRecord; appliedFields: string[] } {
  const appliedFields: string[] = [];
  const incomingNotWorse = contribution.trustScore >= (current.trustScore ?? 0);
  const next: PlaceRecord = { ...current };

  if (
    tryApplyField({
      incoming: contribution.fields.name,
      existing: next.name,
      incomingNotWorse,
      apply: (value) => {
        next.name = value;
      },
    })
  ) appliedFields.push("name");
  if (
    tryApplyField({
      incoming: contribution.fields.nameWithType,
      existing: next.nameWithType,
      incomingNotWorse,
      apply: (value) => {
        next.nameWithType = value;
      },
    })
  ) appliedFields.push("nameWithType");
  if (
    tryApplyField({
      incoming: contribution.fields.kind,
      existing: next.kind,
      incomingNotWorse,
      apply: (value) => {
        next.kind = value;
      },
    })
  ) appliedFields.push("kind");
  if (
    tryApplyField({
      incoming: contribution.fields.parentPlaceId,
      existing: next.parentPlaceId,
      incomingNotWorse,
      apply: (value) => {
        next.parentPlaceId = value;
      },
    })
  ) appliedFields.push("parentPlaceId");
  if (
    tryApplyField({
      incoming: contribution.fields.fiasId,
      existing: next.fiasId,
      incomingNotWorse,
      apply: (value) => {
        next.fiasId = value;
      },
    })
  ) appliedFields.push("fiasId");
  if (
    tryApplyField({
      incoming: contribution.fields.kladrId,
      existing: next.kladrId,
      incomingNotWorse,
      apply: (value) => {
        next.kladrId = value;
      },
    })
  ) appliedFields.push("kladrId");
  if (
    tryApplyField({
      incoming: contribution.fields.oktmo,
      existing: next.oktmo,
      incomingNotWorse,
      apply: (value) => {
        next.oktmo = value;
      },
    })
  ) appliedFields.push("oktmo");
  if (
    tryApplyField({
      incoming: contribution.fields.geometryArtifactKey,
      existing: next.geometryArtifactKey,
      incomingNotWorse,
      apply: (value) => {
        next.geometryArtifactKey = value;
      },
    })
  ) appliedFields.push("geometryArtifactKey");
  if (
    tryApplyField({
      incoming: contribution.fields.centroidLat,
      existing: next.centroidLat,
      incomingNotWorse,
      apply: (value) => {
        next.centroidLat = value;
      },
    })
  ) appliedFields.push("centroidLat");
  if (
    tryApplyField({
      incoming: contribution.fields.centroidLon,
      existing: next.centroidLon,
      incomingNotWorse,
      apply: (value) => {
        next.centroidLon = value;
      },
    })
  ) appliedFields.push("centroidLon");
  if (
    tryApplyField({
      incoming: contribution.fields.bbox,
      existing: next.bbox,
      incomingNotWorse,
      apply: (value) => {
        next.bbox = value;
      },
    })
  ) appliedFields.push("bbox");

  const mergedTrustState = monotonicTrustState(next.trustState, contribution.trustState);
  if (mergedTrustState !== next.trustState) {
    next.trustState = mergedTrustState;
    appliedFields.push("trustState");
  }

  const mergedIsTrusted = Boolean(next.isTrusted) || contribution.isTrusted;
  if (mergedIsTrusted !== next.isTrusted) {
    next.isTrusted = mergedIsTrusted;
    appliedFields.push("isTrusted");
  }

  const mergedTrustScore = Math.max(next.trustScore ?? 0, contribution.trustScore);
  if (mergedTrustScore !== next.trustScore) {
    next.trustScore = mergedTrustScore;
    appliedFields.push("trustScore");
  }

  const mergedProviders = mergeEvidenceProviders(next.evidenceProviders, contribution.provider);
  if (!isDeepStrictEqual(mergedProviders, next.evidenceProviders ?? [])) {
    next.evidenceProviders = mergedProviders;
    appliedFields.push("evidenceProviders");
  }

  if (appliedFields.length > 0) {
    next.trustUpdatedAt = new Date().toISOString();
    appliedFields.push("trustUpdatedAt");
  }

  return { next, appliedFields };
}
