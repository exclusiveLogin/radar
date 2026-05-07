#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportsDir = path.join(root, "reports");
const inputFiles = ["snap_001.json", "snap_002.json", "snap_003.json"];
const outputFile = path.join(reportsDir, "parser-gap-analysis.json");

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeRegionAlias(value) {
  return normalizeText(value)
    .replace(/\bобласть\b/g, "обл")
    .replace(/\bреспублика\b/g, "респ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractRegionMentions(text) {
  const source = String(text ?? "");
  const regionLike = /(област|край|республик|респ\.|обл\.|ао\b)/i;
  const separators = /[\n,;|]+/g;
  const raw = source
    .split(separators)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((part) => regionLike.test(part));

  // Also keep full-line mentions that may include several regions.
  for (const line of source.split("\n")) {
    const value = line.replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (!regionLike.test(value)) continue;
    if (value.length > 120) continue;
    if (!raw.includes(value)) {
      raw.push(value);
    }
  }

  return unique(raw);
}

function textPreview(text, lines = 3) {
  return String(text ?? "")
    .split("\n")
    .slice(0, lines)
    .join(" | ");
}

function buildGeoResult(row) {
  return {
    precision: row.geo?.precision ?? "unknown",
    completeness: row.geo?.completeness ?? 0,
    region: row.geo?.region ?? null,
    places: Array.isArray(row.geo?.places) ? row.geo.places : [],
  };
}

function buildResolvedNames(geoResult) {
  const names = [];
  if (geoResult.region?.name) names.push(geoResult.region.name);
  for (const place of geoResult.places) {
    if (place?.name) names.push(place.name);
  }
  return unique(names);
}

function matchMentionWithResolved(mention, resolvedNames) {
  const mentionNorm = normalizeRegionAlias(mention);
  return resolvedNames.some((name) => {
    const resolvedNorm = normalizeRegionAlias(name);
    return (
      mentionNorm === resolvedNorm ||
      mentionNorm.includes(resolvedNorm) ||
      resolvedNorm.includes(mentionNorm)
    );
  });
}

function collectRows(fileName) {
  const fullPath = path.join(reportsDir, fileName);
  if (!fs.existsSync(fullPath)) return [];
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

const output = {
  generatedAt: new Date().toISOString(),
  source: "reports/snap_*.json",
  totals: {
    files: 0,
    blocks: 0,
    event: 0,
    noise: 0,
    meta: 0,
    unknownGeo: 0,
    eventUnknownGeo: 0,
    multiRegionLikeEvents: 0,
    multiRegionCollapsedToOneOrZero: 0,
    eventTypeNotDetected: 0,
  },
  gaps: {
    eventUnknownGeo: [],
    multiRegionCollapsed: [],
    eventTypeNotDetected: [],
  },
};

for (const fileName of inputFiles) {
  const rows = collectRows(fileName);
  output.totals.files += 1;

  for (const row of rows) {
    output.totals.blocks += 1;
    const kind = row.classification?.kind ?? "unknown";
    if (kind === "event") output.totals.event += 1;
    if (kind === "noise") output.totals.noise += 1;
    if (kind === "meta") output.totals.meta += 1;

    const geoResult = buildGeoResult(row);
    if (geoResult.precision === "unknown") {
      output.totals.unknownGeo += 1;
    }

    const rawText = row.raw?.text ?? "";
    const mentions = extractRegionMentions(rawText);
    const resolvedNames = buildResolvedNames(geoResult);
    const lostMentions = mentions.filter(
      (mention) => !matchMentionWithResolved(mention, resolvedNames),
    );

    if (kind === "event" && geoResult.precision === "unknown") {
      output.totals.eventUnknownGeo += 1;
      output.gaps.eventUnknownGeo.push({
        file: fileName,
        index: row.index,
        eventType: row.event?.eventType ?? null,
        issue: "event_with_unknown_geo",
        textPreview: textPreview(rawText),
        rawText,
        detectedRegionMentions: mentions,
        resolvedNames,
        lostMentions,
        geoResult,
      });
    }

    if (kind === "event" && mentions.length >= 2) {
      output.totals.multiRegionLikeEvents += 1;
      if (geoResult.places.length <= 1) {
        output.totals.multiRegionCollapsedToOneOrZero += 1;
        output.gaps.multiRegionCollapsed.push({
          file: fileName,
          index: row.index,
          eventType: row.event?.eventType ?? null,
          issue: "multi_region_collapsed_to_single_target",
          placesCount: geoResult.places.length,
          textPreview: textPreview(rawText),
          rawText,
          detectedRegionMentions: mentions,
          resolvedNames,
          lostMentions,
          geoResult,
        });
      }
    }

    if (
      kind === "noise" &&
      row.classification?.reason === "event_type_not_detected"
    ) {
      output.totals.eventTypeNotDetected += 1;
      output.gaps.eventTypeNotDetected.push({
        file: fileName,
        index: row.index,
        issue: "event_type_not_detected",
        textPreview: textPreview(rawText),
        rawText,
        detectedRegionMentions: mentions,
        resolvedNames,
        lostMentions,
        geoResult,
      });
    }
  }
}

fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");
console.log(`written: ${outputFile}`);
