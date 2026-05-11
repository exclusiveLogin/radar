import type { AliasDraft, GeoProviderSnapshot, IGeoSourceProvider, PlaceDraft, RegionDraft } from "@radar/shared";
import * as fs from "node:fs";
import * as path from "node:path";

/** Loads optional JSON array from file; returns empty array when missing. */
function loadJsonArray<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T[];
}

export class DictionariesOverrideProvider implements IGeoSourceProvider {
  /** Resolves local dictionaries directory path. */
  private resolveDictionariesRoot(): string {
    return path.resolve(process.cwd(), "../../data/geo/dictionaries");
  }

  /** Reads all override dictionaries from target folder. */
  private readSnapshotData(root: string): {
    regions: RegionDraft[];
    places: PlaceDraft[];
    aliases: AliasDraft[];
  } {
    return {
      regions: loadJsonArray<RegionDraft>(path.join(root, "regions.json")),
      places: loadJsonArray<PlaceDraft>(path.join(root, "places.json")),
      aliases: loadJsonArray<AliasDraft>(path.join(root, "aliases.json")),
    };
  }

  /** Loads geo snapshot from local override dictionaries. */
  async loadSnapshot(): Promise<GeoProviderSnapshot> {
    const root = this.resolveDictionariesRoot();
    const data = this.readSnapshotData(root);

    return {
      sourceId: "dictionaries-override",
      sourceRevision: "local",
      regions: data.regions,
      places: data.places,
      aliases: data.aliases,
    };
  }
}
