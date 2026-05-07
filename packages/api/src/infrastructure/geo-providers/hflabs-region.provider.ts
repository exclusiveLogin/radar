import type { GeoProviderSnapshot, IGeoSourceProvider } from "@radar/shared";
import { listArtifactKeysByPrefix, normalizeName, readArtifactsText, sourceRevision } from "./geo-provider-utils";

function parseDelimited(line: string): string[] {
  if (line.includes(";")) return line.split(";").map((x) => x.trim());
  return line.split(",").map((x) => x.trim());
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
      const idx = {
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

      if (idx.name < 0) continue;
      for (let i = 1; i < lines.length; i += 1) {
        const cells = parseDelimited(lines[i]);
        const name = cells[idx.name];
        if (!name) continue;
        const fias = idx.fias >= 0 ? cells[idx.fias] : undefined;
        const nameWithType = idx.nameWithType >= 0 ? cells[idx.nameWithType] : undefined;
        const shortName = idx.shortType >= 0 ? cells[idx.shortType] : undefined;
        regions.push({
          fiasId: fias,
          kladrId: idx.kladr >= 0 ? cells[idx.kladr] : undefined,
          iso: idx.iso >= 0 ? cells[idx.iso] : undefined,
          name,
          nameWithType: nameWithType || name,
          shortName,
          federalDistrict: idx.federalDistrict >= 0 ? cells[idx.federalDistrict] : undefined,
          frontRegion: false,
          borderRegion: false,
          sourceMeta: {
            okato: idx.okato >= 0 ? cells[idx.okato] : undefined,
            oktmo: idx.oktmo >= 0 ? cells[idx.oktmo] : undefined,
            taxOffice: idx.taxOffice >= 0 ? cells[idx.taxOffice] : undefined,
            postalCode: idx.postalCode >= 0 ? cells[idx.postalCode] : undefined,
            timezone: idx.timezone >= 0 ? cells[idx.timezone] : undefined,
            geonameCode: idx.geonameCode >= 0 ? cells[idx.geonameCode] : undefined,
            geonameId: idx.geonameId >= 0 ? cells[idx.geonameId] : undefined,
            geonameName: idx.geonameName >= 0 ? cells[idx.geonameName] : undefined,
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
