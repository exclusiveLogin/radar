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

function parseDelimited(line: string): string[] {
  if (line.includes(";")) return line.split(";").map((x) => x.trim());
  return line.split(",").map((x) => x.trim());
}

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

function getCell(cells: string[], index: number): string | undefined {
  if (index < 0) return undefined;
  return cells[index];
}

export class HflabsRegionProvider implements IGeoSourceProvider {
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
        const cells = parseDelimited(lines[i]);
        const name = cells[idx.name];
        if (!name) continue;
        const fias = getCell(cells, idx.fias);
        const nameWithType = getCell(cells, idx.nameWithType);
        const shortName = getCell(cells, idx.shortType);
        regions.push({
          fiasId: fias,
          kladrId: getCell(cells, idx.kladr),
          iso: getCell(cells, idx.iso),
          name,
          nameWithType: nameWithType || name,
          shortName,
          federalDistrict: getCell(cells, idx.federalDistrict),
          frontRegion: false,
          borderRegion: false,
          sourceMeta: {
            okato: getCell(cells, idx.okato),
            oktmo: getCell(cells, idx.oktmo),
            taxOffice: getCell(cells, idx.taxOffice),
            postalCode: getCell(cells, idx.postalCode),
            timezone: getCell(cells, idx.timezone),
            geonameCode: getCell(cells, idx.geonameCode),
            geonameId: getCell(cells, idx.geonameId),
            geonameName: getCell(cells, idx.geonameName),
          },
        });
        aliases.push({
          targetKind: "region",
          targetExternalKey: fias ?? normalizeName(name),
          alias: name,
          source: "auto",
        });
        if (nameWithType && normalizeName(nameWithType) !== normalizeName(name)) {
          aliases.push({
            targetKind: "region",
            targetExternalKey: fias ?? normalizeName(name),
            alias: nameWithType,
            source: "auto",
          });
        }
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
