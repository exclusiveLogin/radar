import * as fs from "node:fs";
import * as XLSX from "xlsx";
import type { PlaceDraft } from "@radar/shared";
import { normalizeName, resolvePlaceDraftKey } from "../geo-provider-utils";
import { resolveFiasCatalogRegionCode } from "./fiasRegionAliases";

/** Строка листа cities из 03_all_cities.xlsx (FIAS, BorisGi/lenin). */
export type AllCitiesFiasRow = {
  aoLevel: string;
  region: string;
  munDistrict: string;
  cityType: string;
  city: string;
  okato: string;
  oktmo: string;
  postalCode: string;
};

const COLUMN_ALIASES: Record<keyof AllCitiesFiasRow, string[]> = {
  aoLevel: ["aolevel"],
  region: ["region"],
  munDistrict: ["mun_district"],
  cityType: ["city_type"],
  city: ["city"],
  okato: ["okato"],
  oktmo: ["oktmo"],
  postalCode: ["postalcode"],
};

const CITY_KIND_TYPES = new Set(["г", "г."]);
const SETTLEMENT_KIND_TYPES = new Set(["пгт", "пгт.", "рп", "ст", "ст-ца", "п", "п/ст", "п/о", "пгс"]);

function readCell(row: Record<string, unknown>, key: keyof AllCitiesFiasRow): string {
  for (const alias of COLUMN_ALIASES[key]) {
    const direct = row[alias];
    if (direct != null && String(direct).trim()) {
      return String(direct).trim();
    }
  }
  return "";
}

/** Строка пригодна для импорта: есть субъект и название НП. */
export function isFiasImportableRow(row: AllCitiesFiasRow): boolean {
  const city = row.city.trim();
  const region = row.region.trim();
  if (!city || !region) {
    return false;
  }
  if (city.toLowerCase() === "city" || region.toLowerCase() === "region") {
    return false;
  }
  return true;
}

function mapCityKind(cityType: string, aoLevel: string): PlaceDraft["kind"] {
  const normalized = cityType.trim().toLowerCase();
  if (CITY_KIND_TYPES.has(normalized)) {
    return "city";
  }
  if (SETTLEMENT_KIND_TYPES.has(normalized)) {
    return "settlement";
  }
  if (aoLevel === "4" && (normalized === "с/п" || normalized === "массив")) {
    return "locality";
  }
  return "locality";
}

function buildNameWithType(city: string, cityType: string): string {
  const name = city.trim();
  const type = cityType.trim().toLowerCase();
  if (!type || type === name.toLowerCase()) {
    return name;
  }
  if (type === "г" || type === "г.") {
    return `г. ${name}`;
  }
  if (type === "пгт" || type === "пгт.") {
    return `пгт. ${name}`;
  }
  if (type === "рп") {
    return `рп. ${name}`;
  }
  if (type === "ст-ца") {
    return `ст-ца ${name}`;
  }
  if (type.length <= 6) {
    return `${type}. ${name}`;
  }
  return name;
}

/** Читает лист cities из xlsx (метаданные на отдельном листе meta). */
export function parseAllCitiesFiasXlsx(filePath: string): AllCitiesFiasRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`FIAS cities catalog not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName =
    workbook.SheetNames.find((name) => name.toLowerCase() === "cities")
    ?? workbook.SheetNames[1];
  if (!sheetName) {
    throw new Error(`FIAS cities xlsx has no cities sheet: ${filePath}`);
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  return rawRows.map((row) => ({
    aoLevel: readCell(row, "aoLevel"),
    region: readCell(row, "region"),
    munDistrict: readCell(row, "munDistrict"),
    cityType: readCell(row, "cityType"),
    city: readCell(row, "city"),
    okato: readCell(row, "okato"),
    oktmo: readCell(row, "oktmo"),
    postalCode: readCell(row, "postalCode"),
  }));
}

/** PlaceDraft из всех строк FIAS для geo:db:apply. */
export function mapFiasRowsToPlaceDrafts(rows: AllCitiesFiasRow[]): PlaceDraft[] {
  const seen = new Set<string>();
  const places: PlaceDraft[] = [];

  for (const row of rows) {
    if (!isFiasImportableRow(row)) {
      continue;
    }

    const kind = mapCityKind(row.cityType, row.aoLevel);
    const regionCode = resolveFiasCatalogRegionCode(row.region);
    const draft: PlaceDraft = {
      regionCode,
      kind,
      name: row.city.trim(),
      nameWithType: buildNameWithType(row.city, row.cityType),
      oktmo: row.oktmo || undefined,
      sourceMeta: {
        sourceLayer: "all_cities_fias",
        aoLevel: row.aoLevel,
        cityType: row.cityType || undefined,
        okato: row.okato || undefined,
        munDistrict: row.munDistrict || undefined,
        postalCode: row.postalCode || undefined,
        fiasDatasetDate: "2020-09-08",
      },
    };

    const dedupeKey = resolvePlaceDraftKey(draft);
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    places.push(draft);
  }

  return places;
}

export const ALL_CITIES_FIAS_SOURCE_ID = "all_cities_fias";
export const ALL_CITIES_FIAS_SOURCE_REVISION = "fias-2020-09-08-full";
