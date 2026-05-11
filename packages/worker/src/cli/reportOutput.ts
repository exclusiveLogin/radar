import * as fs from "node:fs";

export type ReportOutputFormat = "json" | "yaml" | "csv";

export type FlatRecord = {
  file: string;
  index: number;
  kind: string;
  eventType: string;
  regionCode: string;
  placeName: string;
  precision: string;
  completeness: number;
  source: string;
};

/** Escapes a single CSV cell according to RFC-compatible quoting rules. */
function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

/** Serializes arbitrary JSON-like payload into minimal YAML text. */
function serializeYaml(value: unknown, depth = 0): string {
  const indent = "  ".repeat(depth);

  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          const nested = serializeYaml(item, depth + 1);
          return `${indent}-\n${nested}`;
        }
        return `${indent}- ${serializeYaml(item, depth + 1)}`;
      })
      .join("\n");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";

  return entries
    .map(([key, item]) => {
      if (typeof item === "object" && item !== null) {
        return `${indent}${key}:\n${serializeYaml(item, depth + 1)}`;
      }
      return `${indent}${key}: ${serializeYaml(item, depth + 1)}`;
    })
    .join("\n");
}

/** Projects parse report payload into flat rows for CSV output. */
export function toFlatRecords(
  fileName: string,
  payload: Array<Record<string, unknown>>,
): FlatRecord[] {
  return payload.map((row, index) => {
    const classification = (row.classification as Record<string, unknown>) ?? {};
    const event = (row.event as Record<string, unknown> | undefined) ?? {};
    const geo = (row.geo as Record<string, unknown>) ?? {};
    const regions = (geo.regions as Array<Record<string, unknown>> | undefined) ?? [];
    const firstRegion = regions[0] ?? {};
    const places = (geo.places as Array<Record<string, unknown>> | undefined) ?? [];
    const firstPlace = places[0] ?? {};

    return {
      file: fileName,
      index,
      kind: String(classification.kind ?? "unknown"),
      eventType: String(event.eventType ?? ""),
      regionCode: String(firstRegion.code ?? ""),
      placeName: String(firstPlace.name ?? ""),
      precision: String(geo.precision ?? "unknown"),
      completeness: Number(geo.completeness ?? 0),
      source: String(geo.source ?? "local"),
    };
  });
}

/** Writes payload to disk in JSON, YAML or CSV format. */
export function writePayload(
  targetPath: string,
  format: ReportOutputFormat,
  payload: unknown,
): void {
  if (format === "json") {
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
    return;
  }

  if (format === "yaml") {
    fs.writeFileSync(targetPath, `${serializeYaml(payload)}\n`, "utf8");
    return;
  }

  const rows = payload as FlatRecord[];
  const header =
    "file,index,kind,event_type,region_code,place_name,precision,completeness,source";
  const body = rows
    .map((row) =>
      [
        row.file,
        row.index,
        row.kind,
        row.eventType,
        row.regionCode,
        row.placeName,
        row.precision,
        row.completeness,
        row.source,
      ]
        .map((cell) => escapeCsv(String(cell)))
        .join(","),
    )
    .join("\n");

  fs.writeFileSync(targetPath, `${header}\n${body}\n`, "utf8");
}
