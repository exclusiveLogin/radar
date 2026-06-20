import type { EventCandidate, EventLocation, ParseWorkspace } from "@radar/shared";
import { groomMessage } from "./groomMessage.js";
import type { MessageBlock } from "@radar/shared";

export type ParseInspectGeoHit = {
  kind: "region" | "place";
  name: string;
  regionIso?: string;
  placeId?: string;
  span?: { start: number; end: number };
  centroidLat?: number;
  centroidLon?: number;
};

export type ParseInspectTrace = {
  classification: "event" | "noise" | "meta";
  reason?: string;
  groomedText: string;
  blockCount: number;
  candidateCount: number;
  placeCandidateCount: number;
  traitKeys: string[];
  hasVicinityTrait: boolean;
  geoConflict?: boolean;
  locationCount: number;
};

/** Короткий human-readable trace для agent debug. */
export function buildParseInspectTrace(input: {
  rawText: string;
  workspace?: ParseWorkspace;
  kind: "event" | "noise" | "meta";
  reason?: string;
  locations?: EventLocation[];
  geoHits?: ParseInspectGeoHit[];
}): { trace: ParseInspectTrace; summaryMd: string } {
  const groomed = groomMessage(input.rawText);
  const blocks = groomed.kind === "event" ? groomed.blocks : [];
  const ws = input.workspace;
  const candidates = ws?.candidates ?? [];
  const placeCandidates = candidates.filter((c: EventCandidate) => c.anchor.kind === "place");

  const trace: ParseInspectTrace = {
    classification: input.kind,
    reason: input.reason ?? (groomed.kind !== "event" ? groomed.reason : undefined),
    groomedText: groomed.kind === "event" ? groomed.groomedText : input.rawText,
    blockCount: blocks.length,
    candidateCount: candidates.length,
    placeCandidateCount: placeCandidates.length,
    traitKeys: [...new Set((ws?.traitAttachments ?? []).map((t) => t.traitKey))],
    hasVicinityTrait: (ws?.traitAttachments ?? []).some(
      (t) => t.traitKey === "vicinity" && t.value === true,
    ),
    geoConflict: ws?.namespaces.geoConflict === true,
    locationCount: input.locations?.length ?? 0,
  };

  const lines = [
    "# Parse inspect summary",
    "",
    `- classification: **${trace.classification}**`,
    trace.reason ? `- reason: ${trace.reason}` : null,
    `- blocks: ${trace.blockCount}`,
    `- candidates: ${trace.candidateCount} (places: ${trace.placeCandidateCount})`,
    `- traits: ${trace.traitKeys.join(", ") || "—"}`,
    `- vicinity trait: ${trace.hasVicinityTrait ? "yes" : "no"}`,
    trace.geoConflict ? "- geoConflict: **true**" : null,
    `- locations preview: ${trace.locationCount}`,
    "",
    "## Groomed text",
    "",
    "```",
    trace.groomedText,
    "```",
    "",
    "## Blocks",
    "",
    ...blocks.map(
      (b: MessageBlock) => `- \`${b.kind}\` [${b.span.start}-${b.span.end}]: ${b.text.slice(0, 80)}`,
    ),
    "",
    "## Place candidates",
    "",
    ...placeCandidates.map(
      (c) => `- ${c.anchor.name} (${c.status}, author=${c.authorProcessorId})`,
    ),
    "",
    input.geoHits?.length
      ? ["## Geo hits", "", ...input.geoHits.map((h) => `- ${h.kind}: ${h.name}`)].join("\n")
      : "",
  ].filter(Boolean);

  return { trace, summaryMd: lines.join("\n") };
}
