import type { StateLevel } from "../../schemas/geo/state-level";
import { STATE_LEVEL_RANK } from "../../schemas/geo/state-level";
import { REGION_CALM_SUPPRESS_MS } from "./mapStateTtl";
import {
  isMapEventOlderThanTtl,
  isPlaceSuppressedByRegionClear,
  type MapStatusAction,
} from "./statusEventOrdering";

/** Факт привязки события к региону/place (строка event_locations + метаданные). */
export type EventLocationFact = {
  factId: string;
  regionId: string;
  regionCode: string;
  placeId: string | null;
  statusCode: string;
  stateLevel: StateLevel;
  action: MapStatusAction;
  occurredAt: string;
  authorChannelKey: string | null;
  entityKind: "region" | "place" | "point" | null;
  lat?: number;
  lon?: number;
  scopeRadiusM?: number;
};

/** Winner сущности после fold. */
export type MapEntityWinner = {
  regionId: string;
  regionCode: string;
  placeId?: string;
  statusCode: string;
  stateLevel: StateLevel;
  action: MapStatusAction;
  occurredAt: string;
};

export type MapStateFoldInput = {
  asOf: Date;
  ttlMs: number;
  facts: EventLocationFact[];
};

export type MapStateFoldResult = {
  regions: MapEntityWinner[];
  places: MapEntityWinner[];
};

type MutableWinner = MapEntityWinner;

function levelRank(level: StateLevel): number {
  return STATE_LEVEL_RANK[level] ?? 0;
}

/**
 * Правило upsert из LastWinnerReadModelProjection:
 * incoming бьёт current если occurredAt новее или равен, и (clear или level >= current).
 */
export function shouldIncomingBeatWinner(
  current: MutableWinner | undefined,
  incoming: EventLocationFact,
): boolean {
  if (!current) return true;
  const inMs = Date.parse(incoming.occurredAt);
  const curMs = Date.parse(current.occurredAt);
  if (!Number.isFinite(inMs) || !Number.isFinite(curMs)) return false;
  if (inMs < curMs) return false;
  if (incoming.action === "clear") return true;
  return levelRank(incoming.stateLevel) >= levelRank(current.stateLevel);
}

function factToWinner(fact: EventLocationFact, placeId?: string): MutableWinner {
  return {
    regionId: fact.regionId,
    regionCode: fact.regionCode,
    placeId,
    statusCode: fact.statusCode,
    stateLevel: fact.stateLevel,
    action: fact.action,
    occurredAt: fact.occurredAt,
  };
}

function foldEntityWinners(
  facts: EventLocationFact[],
  pickKey: (fact: EventLocationFact) => string | null,
  withPlaceId: boolean,
): Map<string, MutableWinner> {
  const byKey = new Map<string, MutableWinner>();
  const sorted = [...facts].sort((a, b) => {
    const at = Date.parse(a.occurredAt);
    const bt = Date.parse(b.occurredAt);
    if (at !== bt) return at - bt;
    return a.factId.localeCompare(b.factId);
  });

  for (const fact of sorted) {
    const key = pickKey(fact);
    if (!key) continue;
    const current = byKey.get(key);
    if (!shouldIncomingBeatWinner(current, fact)) continue;
    byKey.set(
      key,
      factToWinner(fact, withPlaceId ? fact.placeId ?? undefined : undefined),
    );
  }
  return byKey;
}

/** Регион виден в snapshot: не green/grey старше calm-окна. */
export function isRegionVisibleInSnapshot(
  winner: MapEntityWinner,
  asOfMs: number,
): boolean {
  if (winner.stateLevel !== "green" && winner.stateLevel !== "grey") {
    return true;
  }
  const eventMs = Date.parse(winner.occurredAt);
  if (!Number.isFinite(eventMs)) return false;
  return asOfMs - eventMs < REGION_CALM_SUPPRESS_MS;
}

/** Факты region fold: только region-scoped rows (без place raises). */
export function filterRegionScopedFacts(facts: EventLocationFact[]): EventLocationFact[] {
  return facts.filter((fact) => !fact.placeId && fact.entityKind !== "place");
}

function filterInWindow(facts: EventLocationFact[], asOfMs: number, ttlMs: number): EventLocationFact[] {
  return facts.filter((fact) => {
    if (Date.parse(fact.occurredAt) > asOfMs) return false;
    return !isMapEventOlderThanTtl(fact.occurredAt, asOfMs, ttlMs);
  });
}

/** Region winners из region-scoped фактов + visibility filter. */
export function foldRegionMapState(input: MapStateFoldInput): MapEntityWinner[] {
  const asOfMs = input.asOf.getTime();
  const inWindow = filterInWindow(filterRegionScopedFacts(input.facts), asOfMs, input.ttlMs);
  const regionWinners = foldEntityWinners(inWindow, (fact) => fact.regionId, false);

  const regions: MapEntityWinner[] = [];
  for (const [, winner] of regionWinners) {
    if (!isRegionVisibleInSnapshot(winner, asOfMs)) continue;
    regions.push(winner);
  }
  return regions;
}

export type FoldPlaceMapStateInput = {
  asOf: Date;
  ttlMs: number;
  facts: EventLocationFact[];
  regionWinners: MapEntityWinner[];
};

/** Place winners с suppress по region winners. */
export function foldPlaceMapState(input: FoldPlaceMapStateInput): MapEntityWinner[] {
  const asOfMs = input.asOf.getTime();
  const inWindow = filterInWindow(input.facts, asOfMs, input.ttlMs);
  const placeFacts = inWindow.filter(
    (fact) => fact.placeId && fact.entityKind !== "region",
  );
  const placeWinners = foldEntityWinners(placeFacts, (fact) => fact.placeId, true);
  const regionById = new Map(input.regionWinners.map((r) => [r.regionId, r]));

  const places: MapEntityWinner[] = [];
  for (const [, winner] of placeWinners) {
    if (!winner.placeId) continue;
    if (winner.action !== "raise") continue;
    if (winner.stateLevel === "grey") continue;
    const regionWinner = regionById.get(winner.regionId);
    if (!regionWinner) continue;
    if (
      isPlaceSuppressedByRegionClear({
        placeStatusEventAt: winner.occurredAt,
        regionStatusEventAt: regionWinner.occurredAt,
        regionAction: regionWinner.action,
      })
    ) {
      continue;
    }
    places.push(winner);
  }
  return places;
}

export type FoldVicinityScopeMapStateInput = {
  asOf: Date;
  ttlMs: number;
  facts: EventLocationFact[];
  regionWinners: MapEntityWinner[];
};

/** Vicinity scope winners: point + scopeRadiusM, suppress по region clear. */
export function foldVicinityScopeMapState(
  input: FoldVicinityScopeMapStateInput,
): MapEntityWinner[] {
  const asOfMs = input.asOf.getTime();
  const inWindow = filterInWindow(input.facts, asOfMs, input.ttlMs);
  const scopeFacts = inWindow.filter(
    (fact) =>
      fact.entityKind === "point"
      && fact.scopeRadiusM != null
      && fact.lat != null
      && fact.lon != null,
  );
  const scopeWinners = foldEntityWinners(scopeFacts, (fact) => fact.factId, false);
  const regionById = new Map(input.regionWinners.map((r) => [r.regionId, r]));

  const scopes: MapEntityWinner[] = [];
  for (const [, winner] of scopeWinners) {
    if (winner.action !== "raise") continue;
    if (winner.stateLevel === "grey") continue;
    const regionWinner = regionById.get(winner.regionId);
    if (!regionWinner) continue;
    if (
      isPlaceSuppressedByRegionClear({
        placeStatusEventAt: winner.occurredAt,
        regionStatusEventAt: regionWinner.occurredAt,
        regionAction: regionWinner.action,
      })
    ) {
      continue;
    }
    scopes.push(winner);
  }
  return scopes;
}

/**
 * LastWinner fold: статусы карты от фактов и маркера asOf.
 * Stale не хранится — факты вне TTL-окна отфильтровываются заранее.
 */
export function foldMapState(input: MapStateFoldInput): MapStateFoldResult {
  const regions = foldRegionMapState(input);
  const places = foldPlaceMapState({ ...input, regionWinners: regions });
  return { regions, places };
}
