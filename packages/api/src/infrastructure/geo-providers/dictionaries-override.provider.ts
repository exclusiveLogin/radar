import type { AliasDraft, GeoProviderSnapshot, IGeoSourceProvider, PlaceDraft, RegionDraft } from "@radar/shared";
import * as fs from "node:fs";
import * as path from "node:path";

function loadJsonArray<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T[];
}

export class DictionariesOverrideProvider implements IGeoSourceProvider {
  async loadSnapshot(): Promise<GeoProviderSnapshot> {
    const root = path.resolve(process.cwd(), "../../data/geo/dictionaries");
    const regions = loadJsonArray<RegionDraft>(path.join(root, "regions.json"));
    const places = loadJsonArray<PlaceDraft>(path.join(root, "places.json"));
    const aliases = loadJsonArray<AliasDraft>(path.join(root, "aliases.json"));

    return {
      sourceId: "dictionaries-override",
      sourceRevision: "local",
      regions,
      places,
      aliases,
    };
  }
}
