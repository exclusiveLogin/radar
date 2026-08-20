import type {
  EventCandidate,
  EventLocation,
  IPlaceRepository,
  IRegionRepository,
  ParseWorkspace,
} from "@radar/shared";
import { canonicalRegionCode } from "@radar/shared";
import { distanceKm } from "../geo/coordRegionReconcile.js";
import { resolveAttachTargets } from "./attachRule.js";
import { resolveEventTypeForCandidate } from "./resolveEventTypeForCandidate.js";

export const DEFAULT_VICINITY_RADIUS_M = 5000;
const VICINITY_TRAIT_KEY = "vicinity";

type Coord = { lat: number; lon: number };

/** Доминирующий regionId среди place-candidates (mode). */
async function dominantRegionId(
  candidates: EventCandidate[],
  places: IPlaceRepository,
): Promise<string | undefined> {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    if (c.anchor.kind !== "place" || !c.anchor.placeId) continue;
    const place = await places.findById(c.anchor.placeId);
    if (!place) continue;
    counts.set(place.regionId, (counts.get(place.regionId) ?? 0) + 1);
  }
  let best: string | undefined;
  let max = 0;
  for (const [id, n] of counts) {
    if (n > max) {
      max = n;
      best = id;
    }
  }
  return best;
}

async function resolveCoord(
  candidate: EventCandidate,
  places: IPlaceRepository,
): Promise<Coord | null> {
  if (candidate.anchor.lat != null && candidate.anchor.lon != null) {
    return { lat: candidate.anchor.lat, lon: candidate.anchor.lon };
  }
  if (!candidate.anchor.placeId) return null;
  const place = await places.findById(candidate.anchor.placeId);
  if (place?.centroidLat != null && place.centroidLon != null) {
    return { lat: place.centroidLat, lon: place.centroidLon };
  }
  return null;
}

/** Bbox padding → radius (+50%). */
export function computeVicinityRadiusM(coords: Coord[]): number {
  if (coords.length === 0) return DEFAULT_VICINITY_RADIUS_M;
  if (coords.length === 1) return DEFAULT_VICINITY_RADIUS_M;

  const lats = coords.map((c) => c.lat);
  const lons = coords.map((c) => c.lon);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const maxLat = Math.max(...lats);
  const maxLon = Math.max(...lons);

  const halfLatM = distanceKm(centerLat, centerLon, maxLat, centerLon) * 1000;
  const halfLonM = distanceKm(centerLat, centerLon, centerLat, maxLon) * 1000;
  const basePadM = Math.max(halfLatM, halfLonM, 500);
  return basePadM * 1.5;
}

export function computeVicinityCenter(coords: Coord[]): Coord {
  if (coords.length === 0) return { lat: 0, lon: 0 };
  if (coords.length === 1) return coords[0]!;
  const lats = coords.map((c) => c.lat);
  const lons = coords.map((c) => c.lon);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
}

/**
 * Finalizer: vicinity trait → одна point-локация с scopeRadiusM на anchor-candidate.
 */
export async function applyVicinityScope(input: {
  workspace: ParseWorkspace;
  materializedCandidateIds: string[];
  regions: IRegionRepository;
  places: IPlaceRepository;
}): Promise<{ anchorCandidateId: string; location: EventLocation } | null> {
  const vicinityAttachment = input.workspace.traitAttachments.find(
    (t) => t.traitKey === VICINITY_TRAIT_KEY && t.value === true,
  );
  if (!vicinityAttachment) return null;

  const idSet = new Set(input.materializedCandidateIds);
  const targets = resolveAttachTargets(input.workspace, vicinityAttachment.attachRule)
    .filter((c) => c.anchor.kind === "place" && idSet.has(c.id));

  if (targets.length === 0) return null;

  const coords: Coord[] = [];
  for (const candidate of targets) {
    const coord = await resolveCoord(candidate, input.places);
    if (coord) coords.push(coord);
  }

  const center = computeVicinityCenter(coords);
  const radiusM = computeVicinityRadiusM(coords);

  const anchorCandidate = [...targets].sort(
    (a, b) => (a.anchor.span?.start ?? 0) - (b.anchor.span?.start ?? 0),
  )[0]!;

  const regionId = await dominantRegionId(targets, input.places);
  let region = regionId ? await input.regions.findById(regionId) : null;
  if (!region && anchorCandidate.anchor.placeId) {
    const place = await input.places.findById(anchorCandidate.anchor.placeId);
    if (place) region = await input.regions.findById(place.regionId);
  }
  if (!region) {
    const code = anchorCandidate.anchor.regionCode;
    if (code) region = await input.regions.findByCode(code);
  }
  if (!region) return null;

  const eventType = resolveEventTypeForCandidate(anchorCandidate, input.workspace);

  const location: EventLocation = {
    regionId: region.id,
    regionCode: canonicalRegionCode(region),
    precision: "vicinity",
    entityKind: "point",
    lat: center.lat,
    lon: center.lon,
    scopeRadiusM: radiusM,
    source: "db",
    confidence: 0.75,
    statusCode: eventType !== "unknown" ? eventType : "danger",
  };

  return { anchorCandidateId: anchorCandidate.id, location };
}

/** Есть ли vicinity trait в workspace. */
export function hasVicinityTrait(workspace: ParseWorkspace): boolean {
  return workspace.traitAttachments.some(
    (t) => t.traitKey === VICINITY_TRAIT_KEY && t.value === true,
  );
}

/** Place winners для vicinity scope (materialized + overlap). */
export function vicinityPlaceCandidates(
  workspace: ParseWorkspace,
  materializedCandidateIds: string[],
): EventCandidate[] {
  const attachment = workspace.traitAttachments.find(
    (t) => t.traitKey === VICINITY_TRAIT_KEY && t.value === true,
  );
  if (!attachment) return [];
  const idSet = new Set(materializedCandidateIds);
  return resolveAttachTargets(workspace, attachment.attachRule).filter(
    (c) => c.anchor.kind === "place" && idSet.has(c.id),
  );
}
