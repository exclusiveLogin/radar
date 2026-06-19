import type { EventCandidate, EventLocation } from "@radar/shared";

const NIL_REGION_ID = "00000000-0000-0000-0000-000000000000";

/** Проекция anchor candidate → EventLocation[] (output finalizer path). */
export function deriveEventLocationsFromCandidate(
  candidate: EventCandidate,
): EventLocation[] {
  if (candidate.anchor.kind === "system") {
    return [];
  }

  if (candidate.anchor.kind === "region") {
    if (!candidate.anchor.regionCode) return [];
    return [
      {
        regionId: NIL_REGION_ID,
        regionCode: candidate.anchor.regionCode,
        regionFias: candidate.anchor.placeFias,
        placeName: candidate.anchor.name,
        precision: "region",
        entityKind: "region",
        source: candidate.authorEnricherId === "llm" ? "llm" : "db",
        confidence: candidate.trust / 100,
      },
    ];
  }

  if (!candidate.anchor.regionCode) return [];
  return [
    {
      regionId: NIL_REGION_ID,
      regionCode: candidate.anchor.regionCode,
      placeName: candidate.anchor.name,
      placeFias: candidate.anchor.placeFias,
      lat: candidate.anchor.lat,
      lon: candidate.anchor.lon,
      precision: "city",
      entityKind: "place",
      source: candidate.authorEnricherId === "llm" ? "llm" : "db",
      confidence: candidate.trust / 100,
    },
  ];
}
