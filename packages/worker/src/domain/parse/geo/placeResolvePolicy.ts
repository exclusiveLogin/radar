import type { PlaceKindHint, PlaceRecord, PlaceScanEntry } from "@radar/shared";
import { collectPlaceMatchStems, placeStem, placeStemCore } from "@radar/shared";
import { kindMeetsFloor, sortPlaceScanEntriesStable } from "@radar/shared";

export type ResolveStemInput = {
  label: string;
  kindHint?: PlaceKindHint;
  /** Один субъект (shorthand). */
  regionScopeId?: string;
  /** Несколько явных субъектов — уникальность внутри объединения. */
  regionScopeIds?: ReadonlySet<string>;
  regionScopeIso?: string;
  /** district/MO — не ограничен kindFloor=city */
  allowDistrict?: boolean;
};

export type ResolveStemResult = {
  entry: PlaceScanEntry;
  geoImprecise: boolean;
  /** Матч через «…ский → …ск», а не primary stem label. */
  matchedViaAdjectiveStem: boolean;
  /** Размер filtered pool (уникальность = 1). */
  stemPoolSize: number;
};

/** Primary stem + опциональный adjective-alt («Северский» / «Северский район» → «северск»). */
function adjectiveAltStem(label: string): string | null {
  const core = label.replace(/\s+(?:мо|го|район|р-н)\s*$/iu, "").trim();
  const adjective = core.match(/^(.+?)(?:ский|ской)$/iu);
  if (!adjective) return null;
  const alt = placeStemCore(`${adjective[1]!}ск`);
  const primary = placeStemCore(core);
  if (!alt || alt === primary) return null;
  return alt;
}

function effectiveScopeIds(input: ResolveStemInput): ReadonlySet<string> | undefined {
  if (input.regionScopeIds && input.regionScopeIds.size > 0) return input.regionScopeIds;
  if (input.regionScopeId) return new Set([input.regionScopeId]);
  return undefined;
}

/** Резолв stem → canonical PlaceScanEntry (ADR-012 §2 + ADR-027 сигналы). */
export function resolveStemToEntry(
  entriesByStem: Map<string, PlaceScanEntry[]>,
  input: ResolveStemInput,
): ResolveStemResult | null {
  const stems = collectPlaceMatchStems(input.label);
  if (stems.length === 0) {
    stems.push(placeStem(input.label));
  }

  const minKind: PlaceRecord["kind"] =
    input.kindHint === "district" || input.allowDistrict ? "district" : "city";
  const viaAdjective = adjectiveAltStem(input.label);
  const scopeIds = effectiveScopeIds(input);

  for (const stem of stems) {
    const pool = entriesByStem.get(stem) ?? [];
    if (pool.length === 0) continue;

    let filtered = pool.filter((e) => kindMeetsFloor(e.kind, minKind));
    if (scopeIds) {
      filtered = filtered.filter((e) => scopeIds.has(e.regionId));
    }

    if (filtered.length === 0) continue;

    const sorted = sortPlaceScanEntriesStable(filtered);
    return {
      entry: sorted[0]!,
      geoImprecise: sorted.length > 1 && !scopeIds,
      matchedViaAdjectiveStem: viaAdjective !== null && stem === viaAdjective,
      stemPoolSize: sorted.length,
    };
  }

  return null;
}

/** RVK: один явный субъект + N place → общий regionScope. */
export function pickRegionScopeIso(explicitRegionIsos: string[] | undefined): string | undefined {
  if (!explicitRegionIsos || explicitRegionIsos.length !== 1) {
    return undefined;
  }
  return explicitRegionIsos[0];
}

/**
 * Собирает regionId явных субъектов для сужения place-пула.
 * Приоритет: regionScopeId → explicitRegionIsos → regionScopeIso.
 */
export function resolveRegionScopeIds(input: {
  regionScopeId?: string;
  regionScopeIso?: string;
  explicitRegionIsos?: readonly string[];
  regionEntries: readonly PlaceScanEntry[];
}): Set<string> | undefined {
  if (input.regionScopeId) return new Set([input.regionScopeId]);

  const isos =
    input.explicitRegionIsos && input.explicitRegionIsos.length > 0
      ? input.explicitRegionIsos
      : input.regionScopeIso
        ? [input.regionScopeIso]
        : [];
  if (isos.length === 0) return undefined;

  const ids = new Set<string>();
  for (const iso of isos) {
    const entry = input.regionEntries.find((e) => e.regionIso === iso);
    if (entry) ids.add(entry.regionId);
  }
  return ids.size > 0 ? ids : undefined;
}
