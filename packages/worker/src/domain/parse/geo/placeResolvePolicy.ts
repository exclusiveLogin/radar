import type { PlaceKindHint, PlaceRecord, PlaceScanEntry } from "@radar/shared";
import { collectPlaceMatchStems, placeStem } from "@radar/shared";
import { kindMeetsFloor, sortPlaceScanEntriesStable } from "@radar/shared";

export type ResolveStemInput = {
  label: string;
  kindHint?: PlaceKindHint;
  regionScopeId?: string;
  regionScopeIso?: string;
  /** district/MO — не ограничен kindFloor=city */
  allowDistrict?: boolean;
};

/** Резолв stem → canonical PlaceScanEntry (ADR-012 §2). */
export function resolveStemToEntry(
  entriesByStem: Map<string, PlaceScanEntry[]>,
  input: ResolveStemInput,
): { entry: PlaceScanEntry; geoImprecise: boolean } | null {
  const stems = collectPlaceMatchStems(input.label);
  if (stems.length === 0) {
    stems.push(placeStem(input.label));
  }

  const minKind: PlaceRecord["kind"] =
    input.kindHint === "district" || input.allowDistrict ? "district" : "city";

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
