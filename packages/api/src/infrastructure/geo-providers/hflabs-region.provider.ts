import type { GeoProviderSnapshot, IGeoSourceProvider } from "@radar/shared";
import { listArtifactKeysByPrefix, normalizeName, readArtifactsText, sourceRevision } from "./geo-provider-utils";

type HeaderIndex = {
  fias: number;
  kladr: number;
  iso: number;
  name: number;
  nameWithType: number;
  shortType: number;
  federalDistrict: number;
  okato: number;
  oktmo: number;
  taxOffice: number;
  postalCode: number;
  timezone: number;
  geonameCode: number;
  geonameId: number;
  geonameName: number;
};

/** Splits CSV/semicolon line and trims all cells. */
function parseDelimited(line: string): string[] {
  if (line.includes(";")) return line.split(";").map((x) => x.trim());
  return line.split(",").map((x) => x.trim());
}

/** Builds indexes for required HFLabs CSV columns. */
function buildHeaderIndex(header: string[]): HeaderIndex {
  return {
    fias: header.findIndex((h) => h === "fias id"),
    kladr: header.findIndex((h) => h === "kladr id"),
    iso: header.findIndex((h) => h === "iso code"),
    name: header.findIndex((h) => h === "name"),
    nameWithType: header.findIndex((h) => h === "name with type"),
    shortType: header.findIndex((h) => h === "type"),
    federalDistrict: header.findIndex((h) => h === "federal district"),
    okato: header.findIndex((h) => h === "okato"),
    oktmo: header.findIndex((h) => h === "oktmo"),
    taxOffice: header.findIndex((h) => h === "tax office"),
    postalCode: header.findIndex((h) => h === "postal code"),
    timezone: header.findIndex((h) => h === "timezone"),
    geonameCode: header.findIndex((h) => h === "geoname code"),
    geonameId: header.findIndex((h) => h === "geoname id"),
    geonameName: header.findIndex((h) => h === "geoname name"),
  };
}

/** Returns column value by index, handling missing columns. */
function getCell(cells: string[], index: number): string | undefined {
  if (index < 0) return undefined;
  return cells[index];
}

/** Converts one CSV row into region + region aliases drafts. */
function appendRegionDraft(options: {
  cells: string[];
  idx: HeaderIndex;
  regions: GeoProviderSnapshot["regions"];
  aliases: GeoProviderSnapshot["aliases"];
}): void {
  const name = options.cells[options.idx.name];
  if (!name) {
    return;
  }
  const fias = getCell(options.cells, options.idx.fias);
  const nameWithType = getCell(options.cells, options.idx.nameWithType);
  const shortName = getCell(options.cells, options.idx.shortType);

  options.regions.push({
    fiasId: fias,
    kladrId: getCell(options.cells, options.idx.kladr),
    iso: getCell(options.cells, options.idx.iso),
    name,
    nameWithType: nameWithType || name,
    shortName,
    federalDistrict: getCell(options.cells, options.idx.federalDistrict),
    frontRegion: false,
    borderRegion: false,
    sourceMeta: {
      okato: getCell(options.cells, options.idx.okato),
      oktmo: getCell(options.cells, options.idx.oktmo),
      taxOffice: getCell(options.cells, options.idx.taxOffice),
      postalCode: getCell(options.cells, options.idx.postalCode),
      timezone: getCell(options.cells, options.idx.timezone),
      geonameCode: getCell(options.cells, options.idx.geonameCode),
      geonameId: getCell(options.cells, options.idx.geonameId),
      geonameName: getCell(options.cells, options.idx.geonameName),
    },
  });

  const targetExternalKey = fias ?? normalizeName(name);
  options.aliases.push({
    targetKind: "region",
    targetExternalKey,
    alias: name,
    source: "auto",
  });
  if (nameWithType && normalizeName(nameWithType) !== normalizeName(name)) {
    options.aliases.push({
      targetKind: "region",
      targetExternalKey,
      alias: nameWithType,
      source: "auto",
    });
  }
}

export class HflabsRegionProvider implements IGeoSourceProvider {
  /** Loads region snapshot from HFLabs CSV artifacts. */
  async loadSnapshot(): Promise<GeoProviderSnapshot> {
    const sourceId = "hflabs-region";
    const files = listArtifactKeysByPrefix(sourceId, "reference/hflabs-region");
    const regions: GeoProviderSnapshot["regions"] = [];
    const aliases: GeoProviderSnapshot["aliases"] = [];

    const csvCandidates = files.filter((f) => f.endsWith(".csv"));
    for (const file of csvCandidates) {
      const content = readArtifactsText(file);
      if (!content) continue;

      const lines = content.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue;
      const header = parseDelimited(lines[0]).map((x) => normalizeName(x));
      const idx = buildHeaderIndex(header);

      if (idx.name < 0) continue;
      for (let i = 1; i < lines.length; i += 1) {
        appendRegionDraft({
          cells: parseDelimited(lines[i]),
          idx,
          regions,
          aliases,
        });
      }
    }

    return {
      sourceId,
      sourceRevision: sourceRevision(sourceId),
      regions,
      places: [],
      aliases,
    };
  }
}
