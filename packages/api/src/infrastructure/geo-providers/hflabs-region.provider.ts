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
      const fiasIdx = header.findIndex((h) => h.includes("fias"));
      const nameIdx = header.findIndex((h) => h.includes("name"));

      if (nameIdx < 0) continue;
      for (let i = 1; i < lines.length; i += 1) {
        const cells = parseDelimited(lines[i]);
        const name = cells[nameIdx];
        if (!name) continue;
        const fias = fiasIdx >= 0 ? cells[fiasIdx] : undefined;
        regions.push({
          fiasId: fias,
          name,
          nameWithType: name,
          frontRegion: false,
          borderRegion: false,
        });
        aliases.push({
          targetKind: "region",
          targetExternalKey: fias ?? normalizeName(name),
          alias: name,
          source: "auto",
        });
      }
      if (regions.length > 0) break;
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
