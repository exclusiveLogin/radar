import type { PlaceKindHint, PlaceRecord, PlaceScanEntry } from "@radar/shared";
import { collectPlaceMatchStems, placeStem, placeStemCore } from "@radar/shared";
import { kindMeetsFloor, sortPlaceScanEntriesStable } from "@radar/shared";

export type ResolveStemInput = {
  label: string;
  kindHint?: PlaceKindHint;
  regionScopeId?: string;
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

  for (const stem of stems) {
    const pool = entriesByStem.get(stem) ?? [];
    if (pool.length === 0) continue;

    let filtered = pool.filter((e) => kindMeetsFloor(e.kind, minKind));
    if (input.regionScopeId) {
      filtered = filtered.filter((e) => e.regionId === input.regionScopeId);
    }

    if (filtered.length === 0) continue;

    const sorted = sortPlaceScanEntriesStable(filtered);
    return {
      entry: sorted[0]!,
      geoImprecise: sorted.length > 1 && !input.regionScopeId,
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
